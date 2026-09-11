// ════════════════════════════════════════════════════════════════════
// Shared email sending (Brevo) — used by /api/send-email (user-triggered)
// and the cron routes. Server-only. Requires SUPABASE_SERVICE_ROLE_KEY +
// BREVO_API_KEY. Provides a branded HTML template + per-recipient merge
// fields ({{first_name}}, {{expired_date}}, {{renew_button}}, etc.).
// ════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from '@/lib/supabaseConfig'
import { signMember } from '@/lib/renewToken'

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const BREVO_API_KEY = process.env.BREVO_API_KEY
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'info@footcandle.org'
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Footcandle Film Society'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://members.footcandle.org'
const BRAND = '#2a5680'
const BRAND_DARK = '#1e3f5f'
const BATCH = 500

export function admin() {
  if (!SERVICE) throw new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.')
  return createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function chunk<T>(arr: T[], n: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
function fmtDate(s: string | null | undefined) {
  if (!s) return ''
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z')
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export type MemberCtx = {
  id?: string; email: string; full_name?: string | null; first_name?: string | null
  renewal_date?: string | null; expired_date?: string | null; autorenew?: boolean | null
}

// Branded, email-client-safe wrapper: logo header + content + footer.
export function renderEmail(innerHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6eaef;border-radius:12px;">
        <tr><td align="center" style="padding:24px 28px;border-bottom:1px solid #eef1f5;">
          <img src="${SITE_URL}/footcandle-logo.png" alt="Footcandle Film Society" width="240" style="display:block;width:240px;max-width:70%;height:auto;" />
        </td></tr>
        <tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1f2937;">${innerHtml}</td></tr>
        <tr><td align="center" style="background:${BRAND_DARK};padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#aebfd0;border-radius:0 0 12px 12px;">
          Footcandle Film Society &middot; Catawba County, Western North Carolina<br/>
          <a href="mailto:info@footcandle.org" style="color:#cfe0ef;">info@footcandle.org</a> &middot; You like movies. So do we.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function renewButton(url: string, label = 'Renew my membership') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center" style="border-radius:8px;background:${BRAND};">` +
    `<a href="${url}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>` +
    `</td></tr></table>`
}

// Substitute merge fields for one recipient and return HTML body content.
export function personalizeBody(bodyText: string, ctx: MemberCtx): string {
  const first = (ctx.first_name || (ctx.full_name ? ctx.full_name.split(/\s+/)[0] : '') || 'there')
  const renewUrl = ctx.id ? `${SITE_URL}/renew?t=${signMember(ctx.id)}` : `${SITE_URL}/login`
  const values: Record<string, string> = {
    first_name: escapeHtml(first),
    name: escapeHtml(ctx.full_name || ''),
    email: escapeHtml(ctx.email || ''),
    expired_date: fmtDate(ctx.expired_date || ctx.renewal_date),
    renewal_date: fmtDate(ctx.renewal_date),
    autorenew: ctx.autorenew ? 'Yes' : 'No',
    renew_link: renewUrl,
  }
  let html = escapeHtml(bodyText)
  html = html.replace(/\{\{(first_name|name|email|expired_date|renewal_date|autorenew|renew_link)\}\}/g, (_m, k) => values[k] ?? '')
  html = html.replace(/\{\{renew_button\}\}/g, renewButton(renewUrl))
  html = html.replace(/\n/g, '<br/>')
  return html
}

// Resolve recipients WITH member context so merge fields can personalize.
export async function resolveRecipients(row: any): Promise<MemberCtx[]> {
  const cols = 'id,email,full_name,first_name,renewal_date,expired_date,autorenew,status'
  let rows: any[] = []
  const explicit = (row.recipient_email || '').split(/[,;]/).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.includes('@'))
  if (explicit.length) {
    const { data } = await admin().from('members').select(cols).in('email', explicit)
    rows = data || []
    const have = new Set(rows.map((m) => (m.email || '').toLowerCase()))
    for (const e of explicit) if (!have.has(e)) rows.push({ email: e })
  } else {
    const f = row.recipient_filter || 'all_members'
    let q = admin().from('members').select(cols).not('email', 'is', null)
    const yearAgo = new Date(); yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)
    const thirtyAgo = new Date(); thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 30)
    const y = yearAgo.toISOString().slice(0, 10)
    const d30 = thirtyAgo.toISOString().slice(0, 10)
    if (f === 'all_active') q = q.eq('status', 'active')
    else if (f === 'all_expired') q = q.eq('status', 'expired')
    else if (f === 'expired_12mo') q = q.eq('status', 'expired').gte('renewal_date', y)
    // Expired within the last 12 months, EXCLUDING the most recent 30 days.
    else if (f === 'expired_12mo_not_recent') q = q.eq('status', 'expired').gte('renewal_date', y).lt('renewal_date', d30)
    // Expired within the last 30 days only.
    else if (f === 'expired_last_30') q = q.eq('status', 'expired').gte('renewal_date', d30)
    const { data } = await q
    rows = data || []
  }
  // De-dupe by email (households share one address) — keep the first.
  const seen = new Set<string>()
  const out: MemberCtx[] = []
  for (const m of rows) {
    const e = (m.email || '').trim().toLowerCase()
    if (!e || !e.includes('@') || seen.has(e)) continue
    seen.add(e)
    out.push({ id: m.id, email: e, full_name: m.full_name, first_name: m.first_name, renewal_date: m.renewal_date, expired_date: m.expired_date, autorenew: m.autorenew })
  }
  return out
}

export async function queueEmail(fields: {
  email_type: string; subject: string; body: string; html_body?: string
  recipient_email?: string; recipient_filter?: string; metadata?: any
}): Promise<string> {
  const { data, error } = await admin().from('email_queue').insert({ status: 'draft', ...fields }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

// Substitute merge fields inside an already-HTML body (e.g. the newsletter
// builder). Unlike personalizeBody it does NOT escape the surrounding HTML.
export function personalizeHtml(html: string, ctx: MemberCtx): string {
  const first = (ctx.first_name || (ctx.full_name ? ctx.full_name.split(/\s+/)[0] : '') || 'there')
  const renewUrl = ctx.id ? `${SITE_URL}/renew?t=${signMember(ctx.id)}` : `${SITE_URL}/login`
  const values: Record<string, string> = {
    first_name: escapeHtml(first), name: escapeHtml(ctx.full_name || ''), email: escapeHtml(ctx.email || ''),
    expired_date: fmtDate(ctx.expired_date || ctx.renewal_date), renewal_date: fmtDate(ctx.renewal_date),
    autorenew: ctx.autorenew ? 'Yes' : 'No', renew_link: renewUrl,
  }
  let out = html.replace(/\{\{(first_name|name|email|expired_date|renewal_date|autorenew|renew_link)\}\}/g, (_m, k) => values[k] ?? '')
  out = out.replace(/\{\{renew_button\}\}/g, renewButton(renewUrl))
  return out
}

// Send an already-queued email via Brevo, personalized per recipient. Marks
// the row sent/failed. Returns the number of recipients sent to.
export async function sendQueued(id: string): Promise<number> {
  if (!BREVO_API_KEY) throw new Error('Server is missing BREVO_API_KEY.')
  const { data: row, error } = await admin().from('email_queue').select('*').eq('id', id).single()
  if (error || !row) throw new Error('Email not found')
  if (row.status === 'sent') throw new Error('Already sent')

  const recipients = await resolveRecipients(row)
  if (!recipients.length) throw new Error('No valid recipients for this email')
  const bodyText = row.body || ''
  const bodyHtml = row.html_body || null
  // Rich HTML bodies (newsletter builder) use personalizeHtml; plain-text
  // bodies use personalizeBody. Either way the branded wrapper is applied.
  const content = (ctx: MemberCtx) => bodyHtml ? renderEmail(personalizeHtml(bodyHtml, ctx)) : renderEmail(personalizeBody(bodyText, ctx))

  let sent = 0
  for (const group of chunk(recipients, BATCH)) {
    const messageVersions = group.map((ctx) => ({
      to: [{ email: ctx.email }],
      htmlContent: content(ctx),
    }))
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        subject: row.subject,
        htmlContent: content(group[0]), // fallback default
        textContent: bodyText || 'View this email in an HTML-capable email client.',
        messageVersions,
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      await admin().from('email_queue').update({ status: 'failed' }).eq('id', id)
      throw new Error(`Brevo error (${res.status}) after ${sent} sent: ${detail}`)
    }
    sent += group.length
  }
  const sentAt = new Date().toISOString()
  await admin().from('email_queue').update({ status: 'sent', sent_at: sentAt }).eq('id', id)
  // Record one email_log row per recipient, so each member's page can show
  // exactly what we sent them. Best-effort: never fail a completed send.
  try {
    const rows = recipients.map((ctx) => ({
      member_id: ctx.id || null, email: ctx.email, subject: row.subject,
      email_type: row.email_type || null, queue_id: id, source: 'send', sent_at: sentAt,
    }))
    if (rows.length) await admin().from('email_log').insert(rows)
  } catch { /* logging is best-effort */ }
  return sent
}

// Send a queued email to ONE test address only (does not touch the row's
// status or audience). Personalizes using that address's member record if any.
export async function sendQueuedTest(id: string, testEmail: string): Promise<number> {
  if (!BREVO_API_KEY) throw new Error('Server is missing BREVO_API_KEY.')
  const email = (testEmail || '').trim().toLowerCase()
  if (!email.includes('@')) throw new Error('Enter a valid test email address.')
  const { data: row, error } = await admin().from('email_queue').select('*').eq('id', id).single()
  if (error || !row) throw new Error('Email not found')

  const ctx = (await resolveRecipients({ recipient_email: email }))[0] || { email }
  const html = row.html_body ? renderEmail(personalizeHtml(row.html_body, ctx)) : renderEmail(personalizeBody(row.body || '', ctx))
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: SENDER_NAME, email: SENDER_EMAIL }, subject: `[TEST] ${row.subject}`, htmlContent: html, textContent: row.body || 'test', to: [{ email }] }),
  })
  if (!res.ok) throw new Error(`Brevo error (${res.status}): ${await res.text()}`)
  return 1
}
