// ════════════════════════════════════════════════════════════════════
// Admin member writes — server-side, service-role. Member records are PII
// and this table is our source of truth, so writes never happen with the
// public anon key in the browser. Reads still use the anon read policy
// client-side; only create/update/delete route through here.
//
// Requires env var SUPABASE_SERVICE_ROLE_KEY (set in Vercel + .env.local).
// Every write requires a valid logged-in Supabase session (bearer token).
// TODO: once real admin roles exist, check role here, not just "logged in".
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { isAdmin } from '@/lib/admin'

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

// Fields an admin may set. Anything else in the payload is ignored.
const EDITABLE = [
  'full_name', 'first_name', 'last_name', 'email',
  'status', 'renewal_date', 'expired_date', 'autorenew', 'membership_type',
] as const

function admin() {
  return createClient(SUPABASE_URL, SERVICE!, { auth: { persistSession: false } })
}

async function requireUser(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user
}

// Require a logged-in admin. Returns a NextResponse to short-circuit on failure,
// or null when the caller is an allowed admin.
async function requireAdmin(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isAdmin(user.email)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  return null
}

function clean(input: Record<string, any>) {
  const out: Record<string, any> = {}
  for (const k of EDITABLE) if (k in input) out[k] = input[k] === '' ? null : input[k]
  return out
}

function guard() {
  if (!SERVICE) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it in Vercel → Settings → Environment Variables (and .env.local for local dev), then redeploy.' },
      { status: 500 },
    )
  }
  return null
}

// Update one member by id. Pass logRenewal:true (the "Renew" button) to also
// record an in-person renewal in membership_payments as an audit entry.
export async function PATCH(req: NextRequest) {
  const g = guard(); if (g) return g
  const denied = await requireAdmin(req); if (denied) return denied
  const { id, updates, logRenewal } = await req.json().catch(() => ({}))
  if (!id || !updates) return NextResponse.json({ error: 'id and updates are required' }, { status: 400 })

  // Snapshot the pre-renewal state for the audit record.
  let prev: any = null
  if (logRenewal) {
    const { data: before } = await admin().from('members').select('status,renewal_date,expired_date,autorenew,membership_type').eq('id', id).maybeSingle()
    prev = before
  }

  const patch = { ...clean(updates), updated_at: new Date().toISOString() }
  const { data, error } = await admin().from('members').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (logRenewal && data) {
    // Best-effort: an in-person renewal is cash/check at the door — no Stripe
    // charge and no known amount, so we just log the event for the history.
    try {
      await admin().from('membership_payments').insert({
        member_id: id, email: data.email, billing_reason: 'in_person', is_subscription: false,
        membership_type: data.membership_type || prev?.membership_type || null, amount_cents: null,
        prev_status: prev?.status ?? null, prev_renewal_date: prev?.renewal_date ?? null, prev_expired_date: prev?.expired_date ?? null, prev_autorenew: prev?.autorenew ?? null,
        new_status: data.status ?? null, new_renewal_date: data.renewal_date ?? null, new_expired_date: data.expired_date ?? null, new_autorenew: data.autorenew ?? null,
      })
    } catch { /* audit log is best-effort */ }
  }
  return NextResponse.json({ member: data })
}

// Create a new member (e.g. a walk-up who joined in person).
export async function POST(req: NextRequest) {
  const g = guard(); if (g) return g
  const denied = await requireAdmin(req); if (denied) return denied
  const { member } = await req.json().catch(() => ({}))
  if (!member?.full_name) return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
  const row = { ...clean(member), updated_at: new Date().toISOString() }
  const { data, error } = await admin().from('members').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ member: data })
}

// Delete a member by id (?id=...).
export async function DELETE(req: NextRequest) {
  const g = guard(); if (g) return g
  const denied = await requireAdmin(req); if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await admin().from('members').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
