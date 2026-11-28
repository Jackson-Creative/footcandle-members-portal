// ════════════════════════════════════════════════════════════════════
// Public checkout for NEW members (/newmember). No login. Collects name +
// email, optionally a SECOND person, then Stripe Checkout. The webhook
// creates the member record(s) on payment. Requires STRIPE_SECRET_KEY.
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe, TIERS } from '@/lib/stripe'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { inquiryIdFromToken } from '@/lib/invite'

export const runtime = 'nodejs'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://members.footcandle.org'

function lineItem(tierKey: string, mode: string) {
  const t = TIERS[tierKey]
  const price_data: any = { currency: 'usd', product_data: { name: `Footcandle Film Society — ${t.label}` }, unit_amount: t.amount }
  if (mode === 'subscription') price_data.recurring = { interval: 'year' }
  return { price_data, quantity: 1 }
}
async function memberIdForEmail(email: string) {
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).from('members').select('id').eq('email', email).limit(1).maybeSingle()
  return data?.id || ''
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 500 })

  const { name, email, tier, mode, second, invite } = await req.json().catch(() => ({}))
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanName || !cleanEmail.includes('@')) return NextResponse.json({ error: 'Please enter your name and a valid email.' }, { status: 400 })
  if (!TIERS[tier as string]) return NextResponse.json({ error: 'Choose a membership type.' }, { status: 400 })
  if (mode !== 'subscription' && mode !== 'payment') return NextResponse.json({ error: 'Choose a payment option.' }, { status: 400 })

  const secondEmail = (second?.email || '').trim().toLowerCase()
  const secondName = (second?.name || '').trim()
  const secondTier = second?.tier === 'student' ? 'student' : 'regular'
  const hasSecond = !!secondEmail && secondEmail.includes('@') && !!secondName

  const line_items = [lineItem(tier, mode)]
  const metadata: Record<string, string> = { member_id: await memberIdForEmail(cleanEmail), tier, mode, email: cleanEmail, name: cleanName, new_member: 'true' }
  // Came from an invitation email? The webhook marks that prospect as joined.
  const inquiryId = inquiryIdFromToken(invite)
  if (inquiryId) metadata.inquiry_id = inquiryId
  if (hasSecond) {
    line_items.push(lineItem(secondTier, mode))
    metadata.household_id = (globalThis.crypto as any).randomUUID()
    metadata.member2_id = await memberIdForEmail(secondEmail)
    metadata.member2_tier = secondTier
    metadata.member2_email = secondEmail
    metadata.member2_name = secondName
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode,
      line_items,
      customer_email: cleanEmail,
      success_url: `${SITE_URL}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/newmember?canceled=1${inquiryId ? `&invite=${encodeURIComponent(String(invite))}` : ''}`,
      metadata,
      ...(mode === 'subscription' ? { subscription_data: { metadata } } : {}),
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start checkout' }, { status: 502 })
  }
}
