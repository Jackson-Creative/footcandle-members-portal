// ════════════════════════════════════════════════════════════════════
// Admin-only: the new-member invitation funnel (Membership Inquiries page).
//   GET                         → the editable invitation + follow-up text
//   POST {action:'send', ids}   → send the invitation to those prospects
//   POST {action:'import', rows:[{name,email}]} → add a pasted list of
//                                  prospects (skips current members/dupes)
//   POST {action:'preview'|'test', key, subject, body[, email]} → render the
//                                  (unsaved) text for a sample person, or
//                                  send that render to one test address
//   POST {action:'save'|'reset', key[, subject, body]} → change the text
// Requires SUPABASE_SERVICE_ROLE_KEY (+ BREVO_API_KEY to send).
// ════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin, sendDirect } from '@/lib/email'
import { isAdmin } from '@/lib/admin'
import {
  DEFAULT_TEMPLATES, FOLLOWUP_DAYS, MERGE_FIELDS, REQUIRED_FIELDS, activeMemberEmails, getTemplate, renderInvite,
  resetTemplate, saveTemplate, sendInviteEmail, type Prospect, type TemplateKey,
} from '@/lib/invite'

export const runtime = 'nodejs'
export const maxDuration = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://members.footcandle.org'
const KEYS: TemplateKey[] = ['membership_invite', 'membership_invite_followup']

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user && isAdmin(data.user.email) ? data.user : null
}
function bad(error: string, status = 400) { return NextResponse.json({ error }, { status }) }
// The funnel needs the columns/table from supabase/membership-invites.sql.
// Check before sending, so an email never goes out that we can't record.
const SETUP_MSG = 'One-time database setup needed: run supabase/membership-invites.sql in Supabase → SQL Editor, then try again.'
async function funnelReady() {
  const a = await admin().from('membership_inquiries').select('id,source,invited_at,followup_sent_at,joined_at').limit(1)
  const b = await admin().from('email_templates').select('key').limit(1)
  return !a.error && !b.error
}

export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return bad('Missing SUPABASE_SERVICE_ROLE_KEY', 500)
  if (!(await requireAdmin(req))) return bad('Not authorized', 403)
  try {
    if (!(await funnelReady())) return NextResponse.json({ setupNeeded: SETUP_MSG, templates: { membership_invite: { ...DEFAULT_TEMPLATES.membership_invite, isDefault: true }, membership_invite_followup: { ...DEFAULT_TEMPLATES.membership_invite_followup, isDefault: true } }, fields: MERGE_FIELDS, followupDays: FOLLOWUP_DAYS })
    const [invite, followup] = await Promise.all(KEYS.map(getTemplate))
    return NextResponse.json({ templates: { membership_invite: invite, membership_invite_followup: followup }, fields: MERGE_FIELDS, followupDays: FOLLOWUP_DAYS })
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Could not load templates')
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return bad('Missing SUPABASE_SERVICE_ROLE_KEY', 500)
  const user = await requireAdmin(req)
  if (!user) return bad('Not authorized', 403)
  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  const key = body.key as TemplateKey

  try {
    if (['send', 'import', 'save', 'reset'].includes(action) && !(await funnelReady())) return bad(SETUP_MSG)

    if (action === 'send') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : []
      if (!ids.length) return bad('No one selected.')
      const { data } = await admin().from('membership_inquiries').select('id,name,email').in('id', ids)
      const people = (data || []) as Prospect[]
      const members = await activeMemberEmails(people.map((p) => p.email))
      let sent = 0, alreadyMembers = 0
      const failed: string[] = []
      for (const p of people) {
        if (members.has(p.email.toLowerCase())) {
          await admin().from('membership_inquiries').update({ joined_at: new Date().toISOString() }).eq('id', p.id)
          alreadyMembers++
          continue
        }
        try {
          await sendInviteEmail('membership_invite', p)
          // A (re)invitation restarts the follow-up clock.
          await admin().from('membership_inquiries').update({ invited_at: new Date().toISOString(), followup_sent_at: null }).eq('id', p.id)
          sent++
        } catch (e) {
          failed.push(`${p.email}: ${e instanceof Error ? e.message : 'failed'}`)
        }
      }
      return NextResponse.json({ ok: true, sent, alreadyMembers, failed })
    }

    if (action === 'import') {
      const rows: { name: string; email: string }[] = (Array.isArray(body.rows) ? body.rows : [])
        .map((r: any) => ({ name: String(r?.name || '').trim(), email: String(r?.email || '').trim().toLowerCase() }))
      const valid = rows.filter((r) => r.email.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
      const invalid = rows.length - valid.length
      const members = await activeMemberEmails(valid.map((r) => r.email))
      const { data: existing } = await admin().from('membership_inquiries').select('email').in('email', valid.map((r) => r.email))
      const seen = new Set((existing || []).map((e: any) => String(e.email).toLowerCase()))
      const toAdd: { name: string; email: string; source: string }[] = []
      let skippedMembers = 0, skippedDuplicates = 0
      for (const r of valid) {
        if (members.has(r.email)) { skippedMembers++; continue }
        if (seen.has(r.email)) { skippedDuplicates++; continue }
        seen.add(r.email)
        toAdd.push({ name: r.name || r.email.split('@')[0], email: r.email, source: 'import' })
      }
      if (toAdd.length) {
        const { error } = await admin().from('membership_inquiries').insert(toAdd)
        if (error) return bad(error.message)
      }
      return NextResponse.json({ ok: true, added: toAdd.length, skippedMembers, skippedDuplicates, invalid })
    }

    if (!KEYS.includes(key)) return bad('Unknown email type.')

    if (action === 'preview' || action === 'test') {
      const subject = String(body.subject ?? '').trim() || DEFAULT_TEMPLATES[key].subject
      const text = String(body.body ?? '').trim() ? String(body.body) : DEFAULT_TEMPLATES[key].body
      // Sample person; the join link goes to the plain sign-up page.
      const r = await renderInvite({ subject, body: text }, { name: 'Jane Smith', joinUrl: `${SITE_URL}/newmember` })
      if (action === 'preview') return NextResponse.json({ subject: r.subject, html: r.html })
      const to = String(body.email || user.email || '').trim().toLowerCase()
      if (!to.includes('@')) return bad('Enter a valid test email.')
      await sendDirect(to, `[TEST] ${r.subject}`, r.html, r.text)
      return NextResponse.json({ ok: true, to })
    }

    if (action === 'save') {
      const subject = String(body.subject || '').trim()
      const text = String(body.body || '')
      if (!subject || !text.trim()) return bad('Subject and text are both required.')
      for (const req of REQUIRED_FIELDS[key]) {
        const options = req.split('|')
        if (!options.some((f) => text.includes(`{{${f}}}`))) return bad(`Keep {{${options[0]}}} in the text — ${options[0] === 'next_screening' ? 'the invitation always points people to the next monthly screening' : 'it’s how people sign up'}.`)
      }
      await saveTemplate(key, { subject, body: text })
      return NextResponse.json({ ok: true })
    }
    if (action === 'reset') {
      await resetTemplate(key)
      return NextResponse.json({ ok: true, template: { ...DEFAULT_TEMPLATES[key], isDefault: true } })
    }
    return bad('Unknown action.')
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Failed', 500)
  }
}
