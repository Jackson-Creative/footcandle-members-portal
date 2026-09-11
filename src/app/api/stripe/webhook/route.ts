// ════════════════════════════════════════════════════════════════════
// Stripe webhook — the source of truth that a payment actually happened.
// Activates the member(s) covered by the payment (one, or a couple paid
// together), stores Stripe ids + a shared household_id, and sends each a
// branded renewal confirmation. Idempotent via the stripe_events table.
// Requires STRIPE_WEBHOOK_SECRET.
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { admin, queueEmail, sendQueued } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://members.footcandle.org'

function plusYear(current: string | null) {
  const today = new Date().toISOString().slice(0, 10)
  const base = current && current.slice(0, 10) > today ? current.slice(0, 10) : today
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}
function pretty(dateStr: string) {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

type Person = { id?: string; email?: string; name?: string; tier?: string }
// What we know about the money behind an activation, for the payment record.
type PayInfo = { paymentIntent: string | null; charge: string | null; amountCents: number | null; billingReason: string }

async function activateOne(p: Person, householdId: string | null, isSub: boolean, customer: string | null, subscription: string | null, pay: PayInfo) {
  const db = admin()
  const mail = (p.email || '').trim().toLowerCase()
  let member: any = null
  if (p.id) { const { data } = await db.from('members').select('*').eq('id', p.id).maybeSingle(); member = data }
  if (!member && mail) { const { data } = await db.from('members').select('*').eq('email', mail).maybeSingle(); member = data }

  const renewal = plusYear(member?.renewal_date || null)
  const tierType = p.tier === 'student' ? 'Student' : 'Regular'

  // Snapshot the membership BEFORE this payment, so a refund can restore it.
  const prev = {
    status: member?.status ?? null, renewal_date: member?.renewal_date ?? null,
    expired_date: member?.expired_date ?? null, autorenew: member?.autorenew ?? null,
  }
  let memberId: string | null = member?.id ?? null

  if (member) {
    await db.from('members').update({
      status: 'active', renewal_date: renewal, expired_date: null, autorenew: isSub,
      stripe_customer_id: customer || member.stripe_customer_id, stripe_subscription_id: subscription || member.stripe_subscription_id,
      household_id: householdId || member.household_id || null, updated_at: new Date().toISOString(),
    }).eq('id', member.id)
  } else if (mail) {
    const { data: created } = await db.from('members').insert({
      full_name: (p.name && p.name.trim()) || mail.split('@')[0], email: mail, status: 'active',
      renewal_date: renewal, autorenew: isSub, membership_type: tierType,
      stripe_customer_id: customer, stripe_subscription_id: subscription, household_id: householdId,
    }).select('id').maybeSingle()
    memberId = created?.id ?? null
  }

  // Record the payment with before/after snapshot (best-effort — the membership
  // change above is what matters most; a failed record must not fail the hook).
  if (mail || memberId) {
    try {
      await db.from('membership_payments').insert({
        member_id: memberId, email: mail || null,
        stripe_payment_intent: pay.paymentIntent, stripe_charge_id: pay.charge,
        stripe_customer_id: customer, stripe_subscription_id: subscription,
        amount_cents: pay.amountCents, currency: 'usd', membership_type: tierType,
        is_subscription: isSub, billing_reason: pay.billingReason,
        prev_status: prev.status, prev_renewal_date: prev.renewal_date, prev_expired_date: prev.expired_date, prev_autorenew: prev.autorenew,
        new_status: 'active', new_renewal_date: renewal, new_expired_date: null, new_autorenew: isSub,
      })
    } catch { /* payment record is best-effort */ }
  }

  if (mail) {
    const displayName = (member?.full_name && String(member.full_name).trim()) || (p.name && p.name.trim()) || mail.split('@')[0]
    const plan = isSub
      ? `You opted to have this membership auto-renew each year. This will continue until you decide to end your membership; you can do this at any time by visiting our Member Portal at ${SITE_URL}.`
      : `This is a one-year membership. You will be notified when it is time to renew if you wish to continue your membership past this year.`
    const body =
      `Thank you — your Footcandle Film Society membership for ${displayName} at the email address ${mail} is confirmed and active through ${pretty(renewal)}.\n\n` +
      `${plan}\n\n` +
      `You will start receiving email notifications of all film screenings and events right away.\n\n` +
      `We'll see you at the movies.\n— Footcandle Film Society`
    try {
      const id = await queueEmail({ email_type: 'renewal_confirmation', recipient_email: mail, subject: 'Your Footcandle Film Society membership is confirmed', body, metadata: { auto: true } })
      await sendQueued(id)
    } catch { /* confirmation email is best-effort; payment already recorded */ }
  }
}

// Activate everyone a payment covers (person1, and person2 if it's a couple).
async function activateFromMeta(meta: any, isSub: boolean, customer: string | null, subscription: string | null, pay: PayInfo, fallbackEmail?: string | null) {
  const hh = meta?.household_id || null
  await activateOne({ id: meta?.member_id, email: meta?.email || fallbackEmail, name: meta?.name, tier: meta?.tier }, hh, isSub, customer, subscription, pay)
  if (meta?.member2_email || meta?.member2_id) {
    await activateOne({ id: meta?.member2_id, email: meta?.member2_email, name: meta?.member2_name, tier: meta?.member2_tier }, hh, isSub, customer, subscription, pay)
  }
}
// Stripe sometimes hands an id, sometimes an expanded object; keep the id.
function idOf(v: any): string | null { return typeof v === 'string' ? v : (v?.id ?? null) }

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Missing STRIPE_WEBHOOK_SECRET' }, { status: 500 })
  const sig = req.headers.get('stripe-signature') || ''
  const raw = await req.text()

  let event: any
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret)
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${e instanceof Error ? e.message : 'bad'}` }, { status: 400 })
  }

  // Idempotency: apply each Stripe event only once.
  const { error: claimErr } = await admin().from('stripe_events').insert({ event_id: event.id })
  if (claimErr && (claimErr as any).code === '23505') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object
      const pay: PayInfo = { paymentIntent: idOf(s.payment_intent), charge: null, amountCents: s.amount_total ?? null, billingReason: 'checkout' }
      await activateFromMeta(s.metadata, !!s.subscription, idOf(s.customer), idOf(s.subscription), pay, s.customer_details?.email || s.customer_email)
    } else if (event.type === 'invoice.paid') {
      const inv = event.data.object
      if (inv.billing_reason === 'subscription_cycle' && inv.subscription) {
        const sub = await getStripe().subscriptions.retrieve(idOf(inv.subscription) as string)
        const pay: PayInfo = { paymentIntent: idOf(inv.payment_intent), charge: idOf(inv.charge), amountCents: inv.amount_paid ?? null, billingReason: 'subscription_cycle' }
        await activateFromMeta(sub.metadata, true, idOf(inv.customer), idOf(inv.subscription), pay, inv.customer_email)
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      // Keep autorenew in sync when someone cancels/re-enables in the billing portal.
      const sub: any = event.data.object
      const stillRenewing = event.type !== 'customer.subscription.deleted' && sub.status !== 'canceled' && !sub.cancel_at_period_end
      for (const memberId of [sub.metadata?.member_id, sub.metadata?.member2_id]) {
        if (memberId) await admin().from('members').update({ autorenew: !!stillRenewing }).eq('id', memberId)
      }
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    try { await admin().from('stripe_events').delete().eq('event_id', event.id) } catch { /* ignore */ }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'handler error' }, { status: 500 })
  }
}
