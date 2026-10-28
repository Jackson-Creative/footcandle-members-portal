# Footcandle Film Society — Members Portal

The website and membership system for Footcandle Film Society, live at
**https://members.footcandle.org**. Shares its database with the
[check-in app](https://github.com/Jackson-Creative/footcandle-checkin) used at the door.

## Features

**Public**
- Home page with upcoming film screenings (posters, showtimes, Closed Captioned flags)
  and community events, each with its own detail page
- Membership info and benefits, a "become a member" interest form, and the Filmmaker
  Grant Program page
- Join online (`/newmember`) — including a second membership (e.g. a spouse) in one payment

**Members**
- Login with an emailed sign-in link or an optional password
- Dashboard: membership status, renewal date, auto-renew, attendance history,
  upcoming screenings, announcements
- Renew online through Stripe — one-time or auto-renewing. Reminder emails contain a
  personal link, so members can renew without logging in
- Update card or cancel auto-renew through Stripe's billing portal

**Admin** (`/admin`, limited to approved email addresses)
- Members: sortable list; profiles with payment history, refunds, email history and
  in-person renewals
- Film screenings (with poster upload and per-showtime Closed Captioned), community
  events, announcements
- Email: compose, email queue (edit drafts, preview, send a test, send), newsletter
  builder, renewal reminders
- Membership inquiries from the public interest form

**Automatic**
- Renewal reminder emails 30 and 7 days before a membership's renewal date (daily);
  members on Stripe auto-renew are skipped
- Monthly digest email on the first Tuesday of the month
- Confirmation emails after every payment

## Tech stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Supabase** — login, database and poster storage (`film-posters` bucket)
- **Stripe** — payments, subscriptions, billing portal
- **Brevo** — email delivery
- **Vercel** — hosting and scheduled jobs

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev                        # http://localhost:3000
```

Run `npm run build` before pushing; it also type-checks the code.

## Environment variables

Listed with explanations in `.env.local.example`. In production they're set in
**Vercel → Settings → Environment Variables**:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Site & admin: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ADMIN_EMAILS`
- Email: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
- Stripe: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- Security: `CRON_SECRET`, `RENEW_LINK_SECRET` (optional)

Keep `NEXT_PUBLIC_ADMIN_EMAILS` set in production — if it's empty, any logged-in user
can open the admin area.

## Deployment

Vercel builds and deploys automatically from the `main` branch. Scheduled jobs are
defined in `vercel.json`:

| Job | Schedule (UTC) |
|---|---|
| `/api/cron/renewal-reminders` | daily, 14:00 |
| `/api/cron/digest` | Tuesdays, 14:00 (sends only on the first Tuesday) |

The Stripe webhook should point to `https://members.footcandle.org/api/stripe/webhook`
and listen for `checkout.session.completed` and `invoice.paid`.

## Database

Supabase project `rcjvdvyaqfpbqjunmqjf`. Main tables: `members`, `film_screenings`,
`screening_dates`, `community_events`, `admin_notes` (announcements), `email_queue`,
`email_log`, `membership_payments`, `membership_inquiries`, `stripe_events`, plus
`events` and `checkins` from the check-in app.

The schema and access rules are managed in the Supabase dashboard and aren't yet saved in
this repo.

## More docs

- `CLAUDE.md` — architecture and conventions for Claude Code sessions
- `EMAIL-SETUP-GUIDE.md` — original email and poster-bucket setup notes (email now
  sends through Brevo)
