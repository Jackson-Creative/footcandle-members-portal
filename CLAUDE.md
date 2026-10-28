# CLAUDE.md — Footcandle Members Portal

Project notes for Claude Code sessions. Keep this file current when architecture,
env vars, tables, or workflows change.

## What this is

The members portal for **Footcandle Film Society** (Western North Carolina), live at
**https://members.footcandle.org**. Owned by Jackson Creative (`Jackson-Creative/footcandle-members-portal`).
Companion app: `Jackson-Creative/footcandle-checkin` (iPad door check-in), which shares the
same Supabase project and the `members` / `events` / `checkins` tables.

It handles: public pages (home, film & community event pages, membership info,
Filmmaker Grant), member login + dashboard, paid joins/renewals via Stripe, and an
admin area (members, screenings, community events, announcements, email queue,
newsletter builder, renewal reminders, membership inquiries).

## Stack

- **Next.js 14** (App Router, `src/app`), React 18, TypeScript (`strict`), Tailwind 3
  (brand colors in `tailwind.config.js`: `brand` `#2a5680`, `brand-dark`, `brand-tint`)
- **Supabase** (project `rcjvdvyaqfpbqjunmqjf`) — auth, Postgres, Storage
- **Stripe** — Checkout (inline `price_data`, no pre-created Prices), webhooks, Billing Portal
- **Brevo** — transactional/broadcast email
- **Vercel** — hosting + Vercel Cron
- Icons: `lucide-react`. Path alias `@/*` → `src/*`.

There are **no tests and no lint config**. Verify changes with `npm run build`
(type-checks) before pushing.

## Commands

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build + type-check
```

Local dev needs `.env.local` (copy `.env.local.example`).

## Layout

```
src/
  app/
    page.tsx                     public home (upcoming screenings + community events), revalidate 60
    film/[id], community/[id]    public detail pages, revalidate 60
    membership, filmmaker-grant-program, newmember   public pages
    login, auth/callback         Supabase auth: magic link or email+password (both offered on /login)
    dashboard                    logged-in member view
    renew (+ RenewForm, success) renew/join; works logged-in OR via signed ?t= link
    admin/                       admin area; layout.tsx gates the UI with isAdmin()
      members, members/[id]      list (sortable) + profile (payments, refunds, email history)
      film-screenings(/manage), community-events, announcements,
      compose, email-queue, newsletter, renewal-reminders, membership-inquiries
    api/                         server routes (see below)
  lib/
    supabase.ts        browser client (anon key) + auth helpers
    supabaseConfig.ts  SUPABASE_URL / SUPABASE_ANON with hard-coded fallbacks
    admin.ts           ADMIN_EMAILS allow-list + isAdmin()
    email.ts           Brevo send, branded template, merge fields, audiences, queueEmail()
    stripe.ts          lazy Stripe client + TIERS (regular $50, student $25; Founders are comp)
    renewToken.ts      HMAC-signed member tokens for passwordless /renew?t= links
    benefits.ts        single source of truth for membership benefits copy
  types/index.ts       Member, CommunityEvent, Event, CheckIn, Announcement
```

## Key patterns (follow these)

- **Reads vs writes.** Browser code reads with the anon key (RLS read policies).
  All writes to member/PII/admin data go through `src/app/api/*` routes using the
  **service-role** key (`SUPABASE_SERVICE_ROLE_KEY`, server-only).
- **API auth.** Client sends `Authorization: Bearer <supabase access token>`. Routes
  resolve the user via `auth.getUser(token)` and check `isAdmin(email)` (see
  `requireUser` / `requireAdmin` in `api/members/route.ts`). Return 401/403 JSON.
  The admin layout check is UI-only — **every admin API route must enforce it too**.
- **Admin allow-list.** `NEXT_PUBLIC_ADMIN_EMAILS` (comma-separated). If empty, admin
  is open to any logged-in user ("setup grace") — make sure it is set in production.
- **Missing env vars fail gracefully**: Stripe/service-role clients are lazy and routes
  return a clear JSON error rather than crashing at import.
- **Cache refresh.** After writes that affect public pages, call `revalidatePath('/')`
  and the relevant `/film/[id]` or `/community/[id]` page.
- **Route header comments.** Each API route starts with a comment block explaining what
  it does, who may call it, and which env vars it needs. Keep that convention.
- **Email.** Queue rows in `email_queue` (drafts are editable; sent rows are locked),
  then send via `sendQueued()`. Audiences (`recipient_filter`): `all_members`,
  `all_active`, `all_expired`, `expired_12mo`, `expired_12mo_not_recent`,
  `expired_last_30`, or explicit `recipient_email` list. Recipients de-duped by email
  (households share an address). Merge fields like `{{first_name}}`, `{{expired_date}}`,
  `{{renew_button}}`. Every send writes `email_log` rows per recipient.

## Payments flow (Stripe)

1. `/renew` (existing member — session or `?t=` token) → `POST /api/checkout`;
   `/newmember` (no login) → `POST /api/checkout-new`. Both support a **second person**
   (spouse) in one payment.
2. `POST /api/stripe/webhook` is the **source of truth**: activates/creates member(s),
   stores `stripe_customer_id` / `stripe_subscription_id`, links couples with
   `household_id`, records `membership_payments` (with a pre-payment snapshot), sends
   the confirmation email. Idempotent via the `stripe_events` table.
   Events: `checkout.session.completed`, `invoice.paid`.
3. `POST /api/billing-portal` — member manages card / cancels auto-renew in Stripe.
4. `POST /api/admin/refund` — refunds a payment and restores the snapshot (leaves
   auto-renew alone). Mainly for accidental double payments.
5. In-person renewals are recorded from the admin member page (`logRenewal`) and
   show in member history.

## Scheduled jobs (`vercel.json`)

| Route | Schedule (UTC) | Notes |
|---|---|---|
| `/api/cron/renewal-reminders` | `0 14 * * *` daily | 30- and 7-day reminders; skips live Stripe auto-renew subscribers |
| `/api/cron/digest` | `0 14 * * 2` Tuesdays | sends only on the first Tuesday of the month; `?force=1` to test |

Both require `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it automatically).

## Supabase

Tables used by this app: `members`, `film_screenings`, `screening_dates`
(per-showtime, incl. `closed_captioned`), `community_events`, `admin_notes`
(announcements), `email_queue`, `email_log`, `membership_payments`,
`membership_inquiries`, `stripe_events`, `checkins` (+ `events`, owned by the check-in app).
Storage bucket: `film-posters` (public; used for film and community-event posters).

**The schema / RLS policies are not in this repo.** Changes to tables are made in the
Supabase dashboard. If you add columns, tell the user the exact SQL to run. TODO: commit
a schema dump under `supabase/`.

`members` is shared with the check-in app, which upserts on `full_name` from Eventive
CSV/sync. Be careful with changes to `members` columns or uniqueness.

## Environment variables

See `.env.local.example`. Set in Vercel → Settings → Environment Variables.

| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase (publishable key; fallbacks hard-coded) |
| `NEXT_PUBLIC_SITE_URL` | public | absolute links in emails / auth redirects |
| `NEXT_PUBLIC_ADMIN_EMAILS` | public | admin allow-list |
| `SUPABASE_SERVICE_ROLE_KEY` | server | admin writes |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | server | email |
| `CRON_SECRET` | server | protects cron routes |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | mixed | payments |
| `RENEW_LINK_SECRET` | server | signs `/renew?t=` links (falls back to `CRON_SECRET`) |

Never commit real secret values. The Supabase publishable key in source is intentional.

## Workflow

- Deploys: Vercel builds from GitHub `main` automatically.
- Claude sessions work on a `claude/*` branch and push there; open a PR only when asked.
- Commit messages follow `Area: what changed` (e.g. `Screenings: per-showtime Closed Captioned flag`).
- After pushing, list any manual steps the user must do (Supabase SQL, Vercel env vars,
  Stripe webhook settings) — the user does those by hand.

## Known gaps / TODO

- No schema/RLS in version control (see above).
- No automated tests or ESLint config.
- `src/types/index.ts` is partial (no types for screenings, email queue, payments).
