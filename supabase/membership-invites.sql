-- Membership invitation funnel (run once in Supabase → SQL Editor).
-- Safe to re-run.

-- Track each prospect's progress through the funnel.
alter table public.membership_inquiries
  add column if not exists source text not null default 'form',   -- 'form' (website) or 'import' (pasted list)
  add column if not exists invited_at timestamptz,                  -- last invitation sent
  add column if not exists followup_sent_at timestamptz,            -- 10-day follow-up sent
  add column if not exists joined_at timestamptz;                   -- paid and became a member

-- Editable email text (the standard invitation and its follow-up).
-- Only the server (service role) reads or writes it, so RLS is on with no policies.
create table if not exists public.email_templates (
  key text primary key,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
