// Admin-only: a member's payment history (live from Stripe, enriched with our
// local snapshots) and their email history (from email_log). Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin } from '@/lib/email'
import { getStripe } from '@/lib/stripe'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user && isAdmin(data.user.email) ? data.user : null
}

export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const memberId = new URL(req.url).searchParams.get('memberId')
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const db = admin()
  const { data: member } = await db.from('members').select('id,email,full_name,stripe_customer_id').eq('id', memberId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const email = (member.email || '').trim().toLowerCase()

  // Our local payment records (hold the before/after snapshot + refund state).
  const { data: localPays } = await db.from('membership_payments').select('*').eq('member_id', memberId).order('created_at', { ascending: false })
  const localByPI = new Map<string, any>()
  for (const p of localPays || []) if (p.stripe_payment_intent) localByPI.set(p.stripe_payment_intent, p)

  // Live payment history from Stripe (complete + authoritative on refund state).
  let payments: any[] = []
  let stripeError: string | null = null
  if (member.stripe_customer_id) {
    try {
      const charges = await getStripe().charges.list({ customer: member.stripe_customer_id, limit: 100 })
      payments = charges.data.map((c: any) => {
        const pi = typeof c.payment_intent === 'string' ? c.payment_intent : (c.payment_intent?.id ?? null)
        const local = pi ? localByPI.get(pi) : null
        return {
          id: c.id,
          payment_intent: pi,
          created: c.created, // unix seconds
          amount_cents: c.amount,
          currency: c.currency,
          status: c.status,
          paid: c.paid,
          refunded: c.refunded,
          amount_refunded_cents: c.amount_refunded,
          description: c.description,
          receipt_url: c.receipt_url,
          membership_type: local?.membership_type || null,
          is_subscription: local?.is_subscription ?? null,
          method: 'stripe',
          can_auto_revert: !!local && !local.refunded, // we have a snapshot to restore
          reverted_on_refund: local?.reverted_on_refund ?? false,
        }
      })
    } catch (e) {
      stripeError = e instanceof Error ? e.message : 'Stripe lookup failed'
    }
  }

  // In-person renewals (cash/check at the door) — recorded by the "Renew"
  // button, not in Stripe — so the history is a complete audit trail.
  const inPerson = (localPays || []).filter((p: any) => p.billing_reason === 'in_person').map((p: any) => ({
    id: `local:${p.id}`, payment_intent: null,
    created: Math.floor(new Date(p.created_at).getTime() / 1000),
    amount_cents: p.amount_cents ?? null, currency: p.currency || 'usd',
    status: 'in_person', paid: true, refunded: false, amount_refunded_cents: 0,
    description: 'In-person renewal', receipt_url: null,
    membership_type: p.membership_type || null, is_subscription: false,
    method: 'in_person', can_auto_revert: false, reverted_on_refund: false,
  }))
  payments = [...payments, ...inPerson].sort((a, b) => (b.created || 0) - (a.created || 0))

  // Email history — sends addressed to this member (by id or matching email).
  let emailQuery = db.from('email_log').select('id,subject,email_type,sent_at,source,email').order('sent_at', { ascending: false }).limit(500)
  emailQuery = email ? emailQuery.or(`member_id.eq.${memberId},email.eq.${email}`) : emailQuery.eq('member_id', memberId)
  const { data: emails } = await emailQuery

  return NextResponse.json({
    member: { id: member.id, email: member.email, full_name: member.full_name, has_stripe: !!member.stripe_customer_id },
    payments, stripeError, emails: emails || [],
  })
}
