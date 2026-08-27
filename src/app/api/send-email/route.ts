// ════════════════════════════════════════════════════════════════════
// Send a queued email via Brevo. User-triggered (Email Queue "Send" button).
// Requires a logged-in session; delegates the actual send to lib/email.
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendQueued, sendQueuedTest } from '@/lib/email'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { isAdmin } from '@/lib/admin'

async function requireUser(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  if (!process.env.BREVO_API_KEY) return NextResponse.json({ error: 'Server is missing BREVO_API_KEY. Add it in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 500 })
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isAdmin(user.email)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id, testEmail } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    if (testEmail) {
      const sent = await sendQueuedTest(id, testEmail)
      return NextResponse.json({ ok: true, sent, test: true })
    }
    const sent = await sendQueued(id)
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status: 502 })
  }
}
