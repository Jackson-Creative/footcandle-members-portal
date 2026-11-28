// ════════════════════════════════════════════════════════════════════
// Scheduled: renewal reminders at 30 and 7 days before renewal_date.
// Run daily by Vercel Cron. Protected by CRON_SECRET.
// Also sends the 10-day follow-up to invited prospects who haven't joined
// (lib/invite), so that needs no cron of its own.
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { admin, queueEmail, sendQueued } from '@/lib/email'
import { sendInviteFollowups } from '@/lib/invite'

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}
function addDaysUTC(n: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized (set CRON_SECRET)' }, { status: 401 })
  if (!process.env.BREVO_API_KEY) return NextResponse.json({ error: 'Missing BREVO_API_KEY' }, { status: 500 })

  const results: any[] = []
  try {
    for (const days of [30, 7]) {
      const dateStr = addDaysUTC(days)
      // Skip anyone who will auto-charge (a live Stripe subscription): they
      // renew automatically and get a confirmation, not a reminder. Everyone
      // else — including members imported as "auto" from Eventive (no Stripe
      // card yet) — still gets reminded.
      const { data } = await admin()
        .from('members')
        .select('email,renewal_date')
        .eq('status', 'active')
        .eq('renewal_date', dateStr)
        .not('email', 'is', null)
        .or('autorenew.eq.false,stripe_subscription_id.is.null')
      const emails = Array.from(new Set((data || []).map((m: any) => (m.email || '').trim().toLowerCase()).filter((e: string) => e.includes('@'))))
      if (!emails.length) { results.push({ days, count: 0 }); continue }

      // Personalized per recipient by the send engine ({{…}} merge fields),
      // wrapped in the branded template, with a passwordless renewal button.
      const body =
        `Dear {{first_name}},\n\n` +
        `This is a friendly reminder that your Footcandle Film Society membership is coming up for renewal on {{renewal_date}} — about ${days} days from now.\n\n` +
        `Renewing takes about a minute, and you won't need a password or an old login — just click below.\n\n` +
        `{{renew_button}}\n\n` +
        `If the button doesn't work, copy and paste this link into your browser:\n{{renew_link}}\n\n` +
        `Thank you for being part of the Footcandle community. We'll see you at the movies!\n\n— Footcandle Film Society`
      const id = await queueEmail({
        email_type: 'renewal_reminder',
        recipient_email: emails.join(','),
        subject: `Your Footcandle Film Society membership renews in ${days} days`,
        body,
        metadata: { days, count: emails.length, auto: true },
      })
      const sent = await sendQueued(id)
      results.push({ days, sent })
    }
    // Invitation follow-ups — isolated so a problem here never blocks reminders.
    let followups: any
    try { followups = await sendInviteFollowups() } catch (e) { followups = { error: e instanceof Error ? e.message : 'failed' } }
    return NextResponse.json({ ok: true, results, followups })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed', results }, { status: 500 })
  }
}
