// ════════════════════════════════════════════════════════════════════
// Public "become a member" interest form. Stores the inquiry and (best-effort)
// emails staff so someone can follow up. No login required.
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { admin, queueEmail, sendQueued } from '@/lib/email'

const STAFF_EMAIL = process.env.BREVO_SENDER_EMAIL || 'info@footcandle.org'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is not configured to receive submissions yet.' }, { status: 500 })
  }
  const { name, email, message, company } = await req.json().catch(() => ({}))
  // Spam trap: real visitors never see or fill the hidden "company" field.
  // Pretend success so bots don't learn anything.
  if (String(company || '').trim()) return NextResponse.json({ ok: true })
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanName || !cleanEmail.includes('@')) {
    return NextResponse.json({ error: 'Please enter your name and a valid email.' }, { status: 400 })
  }

  const { error } = await admin().from('membership_inquiries').insert({ name: cleanName, email: cleanEmail, message: String(message || '').trim() || null })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Notify staff (best-effort — the inquiry is already saved).
  try {
    const body = `New membership interest:\n\nName: ${cleanName}\nEmail: ${cleanEmail}\n${message ? `Message: ${message}\n` : ''}\nReach out with next steps to join.`
    const id = await queueEmail({ email_type: 'membership_interest', recipient_email: STAFF_EMAIL, subject: `New membership interest — ${cleanName}`, body, metadata: { auto: true } })
    await sendQueued(id)
  } catch { /* notification is best-effort */ }

  return NextResponse.json({ ok: true })
}
