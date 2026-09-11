// Admin-only, one-time: reconstruct per-member email history for broadcasts we
// already sent, by re-resolving each sent email_queue row's audience today and
// writing email_log rows (source='backfill'). Approximate — audience membership
// may have changed since the send. Safe to run more than once (skips queue rows
// already backfilled/logged).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin, resolveRecipients } from '@/lib/email'
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
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const db = admin()
  const { data: sent } = await db.from('email_queue').select('*').eq('status', 'sent').order('sent_at', { ascending: true })
  if (!sent || !sent.length) return NextResponse.json({ ok: true, queues: 0, inserted: 0, skipped: 0 })

  // Which queue ids are already represented in email_log (live sends or a prior backfill)?
  const { data: existing } = await db.from('email_log').select('queue_id')
  const done = new Set((existing || []).map((r: any) => r.queue_id).filter(Boolean))

  let inserted = 0, skipped = 0, processed = 0
  for (const row of sent) {
    if (done.has(row.id)) { skipped++; continue }
    let recipients: any[] = []
    try { recipients = await resolveRecipients(row) } catch { recipients = [] }
    if (!recipients.length) { skipped++; continue }
    const logs = recipients.map((ctx) => ({
      member_id: ctx.id || null, email: ctx.email, subject: row.subject,
      email_type: row.email_type || null, queue_id: row.id, source: 'backfill',
      sent_at: row.sent_at || row.created_at || new Date().toISOString(),
    }))
    const { error } = await db.from('email_log').insert(logs)
    if (error) { skipped++; continue }
    inserted += logs.length
    processed++
  }
  return NextResponse.json({ ok: true, queues: sent.length, processed, inserted, skipped })
}
