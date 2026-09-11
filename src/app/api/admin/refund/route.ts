// Admin-only: refund a membership payment and restore the membership to the
// state it was in BEFORE that payment (using the snapshot the webhook saved).
// Auto-renew is intentionally left untouched. Refunds are used mainly to undo
// accidental double-payments, where reverting to "before the duplicate" leaves
// the (already-correct) membership unchanged.
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

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const user = await requireAdmin(req)
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { paymentIntentId, chargeId, revertMembership = true } = await req.json().catch(() => ({}))
  if (!paymentIntentId && !chargeId) return NextResponse.json({ error: 'paymentIntentId or chargeId required' }, { status: 400 })

  const db = admin()

  // 1) Issue the Stripe refund.
  let refund: any
  try {
    refund = await getStripe().refunds.create(paymentIntentId ? { payment_intent: paymentIntentId } : { charge: chargeId })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Refund failed at Stripe' }, { status: 502 })
  }

  // 2) Revert each membership this payment covered, using our saved snapshot.
  //    (A couple paid together = multiple rows sharing one payment_intent.)
  let reverted = 0
  let hadSnapshot = false
  if (paymentIntentId) {
    const { data: rows } = await db.from('membership_payments').select('*').eq('stripe_payment_intent', paymentIntentId)
    for (const row of rows || []) {
      hadSnapshot = true
      if (revertMembership && row.member_id) {
        // Restore status / renewal date / expired date to the pre-payment values.
        // Leave autorenew as-is per policy.
        await db.from('members').update({
          status: row.prev_status,
          renewal_date: row.prev_renewal_date,
          expired_date: row.prev_expired_date,
          updated_at: new Date().toISOString(),
        }).eq('id', row.member_id)
        reverted++
      }
      await db.from('membership_payments').update({
        refunded: true, refunded_at: new Date().toISOString(), refunded_by: user.email || null,
        reverted_on_refund: !!(revertMembership && row.member_id),
      }).eq('id', row.id)
    }
  }

  return NextResponse.json({
    ok: true,
    refundId: refund.id,
    amount_refunded_cents: refund.amount,
    reverted,
    // No local snapshot means we couldn't auto-restore membership dates — the
    // money was refunded but the admin may need to adjust the record by hand.
    membershipAdjusted: hadSnapshot && revertMembership,
    note: hadSnapshot ? null : 'Refund processed. No saved snapshot for this payment, so the membership record was not changed automatically.',
  })
}
