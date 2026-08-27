// Admin-only: render a queued email exactly as it will send (branded template
// + merge fields), for in-page preview. Uses the admin's own member record as
// the sample recipient so {{first_name}} etc. fill in. No email is sent.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin, renderEmail, personalizeHtml, personalizeBody, resolveRecipients } from '@/lib/email'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user && isAdmin(data.user.email) ? data.user : null
}

export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const user = await requireAdmin(req)
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: row } = await admin().from('email_queue').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx = (await resolveRecipients({ recipient_email: user.email }))[0] || { email: user.email || 'friend@example.com', first_name: 'Friend', full_name: 'Friend' }
  const html = row.html_body ? renderEmail(personalizeHtml(row.html_body, ctx)) : renderEmail(personalizeBody(row.body || '', ctx))
  return NextResponse.json({ html, subject: row.subject })
}
