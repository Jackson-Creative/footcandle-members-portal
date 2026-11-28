// ════════════════════════════════════════════════════════════════════
// New-member invitation funnel. A prospect (row in membership_inquiries,
// from the website form or a pasted list) gets a standard invitation with a
// personal "Join" link to /newmember?invite=<token>, which pre-fills their
// name + email. Ten days later, if they still haven't joined, one follow-up.
//
// The invitation + follow-up text is editable by admins (email_templates
// table); the defaults below are used until someone saves a change. Server-
// only. Requires SUPABASE_SERVICE_ROLE_KEY + BREVO_API_KEY.
// ════════════════════════════════════════════════════════════════════
import { admin, escapeHtml, queueEmail, renderEmail, sendQueued } from '@/lib/email'
import { signMember, verifyToken } from '@/lib/renewToken'
import { TIERS } from '@/lib/stripe'
import { MEMBERSHIP_BENEFITS } from '@/lib/benefits'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://members.footcandle.org'
const BRAND = '#2a5680'
export const FOLLOWUP_DAYS = 10

export type TemplateKey = 'membership_invite' | 'membership_invite_followup'
export type Template = { subject: string; body: string }
export type Prospect = { id: string; name: string; email: string }

// Merge fields an admin can use in the editable text. The block fields
// ({{benefits}}, {{dues}}, …) are filled in live when each email is sent.
export const MERGE_FIELDS = ['first_name', 'name', 'next_screening', 'benefits', 'dues', 'upcoming_screenings', 'join_button', 'join_link'] as const
// The invitation must always point people to the next monthly screening.
export const REQUIRED_FIELDS: Record<TemplateKey, string[]> = { membership_invite: ['join_button|join_link', 'next_screening'], membership_invite_followup: ['join_button|join_link'] }

export const DEFAULT_TEMPLATES: Record<TemplateKey, Template> = {
  membership_invite: {
    subject: 'Your invitation to join the Footcandle Film Society',
    body:
      `Hi {{first_name}},\n\n` +
      `Thank you for your interest in joining the Footcandle Film Society! We're a member-supported nonprofit bringing the best of independent, foreign, and award-nominated film to Catawba County and Western North Carolina — with real conversation after every screening. Your membership makes it all possible.\n\n` +
      `As a member, you'll enjoy:\n{{benefits}}\n\n` +
      `Annual membership dues:\n{{dues}}\n\n` +
      `Your first screening as a member:\n{{next_screening}}\n\n` +
      `{{upcoming_screenings}}\n\n` +
      `Joining online takes about a minute. Click below to choose your membership and pay securely online — you'll be added to our member list right away and start receiving invitations to every screening and event.\n\n` +
      `{{join_button}}\n\n` +
      `Questions? Just reply to this email or write to us at info@footcandle.org.\n\n` +
      `We'll see you at the movies!\n— Footcandle Film Society`,
  },
  membership_invite_followup: {
    subject: 'Still interested in joining Footcandle Film Society?',
    body:
      `Hi {{first_name}},\n\n` +
      `A little while ago we sent you an invitation to join the Footcandle Film Society, and we wanted to follow up in case it got buried in your inbox.\n\n` +
      `Annual membership dues:\n{{dues}}\n\n` +
      `Our next monthly screening:\n{{next_screening}}\n\n` +
      `{{upcoming_screenings}}\n\n` +
      `Your personal invitation is still open — joining takes about a minute:\n\n` +
      `{{join_button}}\n\n` +
      `If you have any questions, just reply to this email. We'd love to see you at the movies!\n\n— Footcandle Film Society`,
  },
}

export async function getTemplate(key: TemplateKey): Promise<Template & { isDefault: boolean; updated_at?: string }> {
  const { data } = await admin().from('email_templates').select('subject,body,updated_at').eq('key', key).maybeSingle()
  if (data?.subject && data?.body) return { subject: data.subject, body: data.body, updated_at: data.updated_at, isDefault: false }
  return { ...DEFAULT_TEMPLATES[key], isDefault: true }
}
export async function saveTemplate(key: TemplateKey, t: Template) {
  const { error } = await admin().from('email_templates').upsert({ key, subject: t.subject, body: t.body, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}
export async function resetTemplate(key: TemplateKey) {
  const { error } = await admin().from('email_templates').delete().eq('key', key)
  if (error) throw new Error(error.message)
}

// Invite links carry a signed inquiry id (prefixed so a member renewal token
// can never be read as an invite, or vice versa).
export function inviteToken(inquiryId: string) { return signMember(`inv:${inquiryId}`) }
export function inquiryIdFromToken(token: string | null | undefined): string | null {
  const v = verifyToken(token)
  return v && v.startsWith('inv:') ? v.slice(4) : null
}
export function joinUrl(inquiryId: string) { return `${SITE_URL}/newmember?invite=${inviteToken(inquiryId)}` }

// ── Live content blocks ──────────────────────────────────────────────
function benefitsHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">` +
    MEMBERSHIP_BENEFITS.map((b) => `<tr><td valign="top" style="padding:3px 10px 3px 0;color:${BRAND};font-weight:bold;">&#10003;</td><td style="padding:3px 0;color:#374151;">${escapeHtml(b)}</td></tr>`).join('') +
    `</table>`
}
function benefitsText() { return MEMBERSHIP_BENEFITS.map((b) => `  • ${b}`).join('\n') }

function duesRows() {
  return Object.values(TIERS).map((t) => ({ label: t.label.replace(/ Membership$/, ''), price: `$${t.amount / 100}`, note: t.label.startsWith('Regular') ? 'per person / year' : 'per year' }))
}
function duesHtml() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border:1px solid #e6eaef;border-radius:10px;background:#f4f6f9;">` +
    duesRows().map((r, i, a) => `<tr><td style="padding:12px 16px;${i < a.length - 1 ? 'border-bottom:1px solid #e6eaef;' : ''}font-size:15px;color:#1f2937;"><strong>${r.label}</strong></td><td align="right" style="padding:12px 16px;${i < a.length - 1 ? 'border-bottom:1px solid #e6eaef;' : ''}font-size:15px;color:#1f2937;"><strong style="color:${BRAND};font-size:18px;">${r.price}</strong> <span style="color:#6b7280;">${r.note}</span></td></tr>`).join('') +
    `</table><div style="font-size:13px;color:#6b7280;margin-top:6px;">Pay once for the year or choose auto-renew &mdash; and you can add a second membership (e.g., a spouse) in the same payment.</div>`
}
function duesText() { return duesRows().map((r) => `  • ${r.label}: ${r.price} ${r.note}`).join('\n') + '\n  Pay once for the year or choose auto-renew; you can add a second membership (e.g., a spouse) in the same payment.' }

type DateRow = { screening_date: string; screening_time: string | null; venue: string | null; location_city: string | null; address: string | null; closed_captioned: boolean | null }
type FilmBlock = { id: string; title: string; range: string; places: string; first: string; dates: DateRow[] }

const mdLong = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
const dayLong = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
function time12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  return `${((+h + 11) % 12) + 1}:${m} ${+h >= 12 ? 'p.m.' : 'a.m.'}`
}

// Every published film with upcoming dates, soonest first.
async function upcomingFilms(): Promise<FilmBlock[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await admin().from('film_screenings').select('id,title,published,screening_dates(screening_date,screening_time,venue,location_city,address,closed_captioned)').eq('published', true)
  const out: FilmBlock[] = []
  for (const f of (data || []) as any[]) {
    const dates: DateRow[] = (f.screening_dates || []).filter((d: DateRow) => d.screening_date >= today).sort((a: DateRow, b: DateRow) => (a.screening_date + (a.screening_time || '')).localeCompare(b.screening_date + (b.screening_time || '')))
    if (!dates.length) continue
    const first = dates[0].screening_date, last = dates[dates.length - 1].screening_date
    const range = first === last ? mdLong(first) : first.slice(0, 7) === last.slice(0, 7) ? `${mdLong(first)}–${+last.slice(8, 10)}` : `${mdLong(first)} – ${mdLong(last)}`
    const places = Array.from(new Set(dates.map((d) => [d.venue, d.location_city].filter(Boolean).join(', ')).filter(Boolean))).join(' · ')
    out.push({ id: f.id, title: String(f.title || '').replace(/\s+/g, ' ').trim(), range, places, first, dates })
  }
  return out.sort((a, b) => a.first.localeCompare(b.first))
}

// The next STANDARD monthly screening: the Tue/Wed/Thu run around the 2nd
// Thursday. Recognised as the soonest film that plays on 2+ different days
// and isn't part of the one-night OBSCURA series.
function nextStandard(films: FilmBlock[]): FilmBlock | null {
  return films.find((f) => !/obscura/i.test(f.title) && new Set(f.dates.map((d) => d.screening_date)).size >= 2) || null
}

// One line per day: "Tuesday, December 8 · 4:00 p.m. (closed captioned) & 7:00 p.m." + where.
function showtimeLines(f: FilmBlock) {
  const byDay = new Map<string, DateRow[]>()
  for (const d of f.dates) byDay.set(d.screening_date, [...(byDay.get(d.screening_date) || []), d])
  return Array.from(byDay.entries()).map(([day, rows]) => {
    const times = rows.map((r) => `${time12(r.screening_time)}${r.closed_captioned ? ' (closed captioned)' : ''}`).filter(Boolean).join(' & ')
    const where = Array.from(new Set(rows.map((r) => [r.venue, r.location_city].filter(Boolean).join(', ')).filter(Boolean))).join(' / ')
    return { when: `${dayLong(day)}${times ? ` · ${times}` : ''}`, where }
  })
}
const PAY_IN_PERSON = 'Join before then and this will be your first official screening as a member — free admission. Rather pay in person? Just come to any of these showings: you can sign up and pay your dues right at the screening.'

function nextScreeningHtml(f: FilmBlock | null) {
  if (!f) return `<div style="margin:8px 0 4px;color:#4b5563;">Our next monthly screening will be announced soon &mdash; you can always join and pay in person at any of our monthly screenings.</div>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border:1px solid #e6eaef;border-radius:10px;overflow:hidden;">` +
    `<tr><td style="background:#1e3f5f;padding:12px 16px;"><a href="${SITE_URL}/film/${f.id}" style="color:#ffffff;font-weight:bold;font-size:17px;text-decoration:none;">${escapeHtml(f.title)}</a><div style="color:#ffd76a;font-size:13px;font-weight:bold;letter-spacing:0.04em;margin-top:2px;">${escapeHtml(f.range.toUpperCase())}</div></td></tr>` +
    showtimeLines(f).map((l) => `<tr><td style="padding:10px 16px;border-bottom:1px solid #e6eaef;background:#f4f6f9;font-size:15px;line-height:1.45;color:#1f2937;"><strong>${escapeHtml(l.when)}</strong>${l.where ? `<br/><span style="color:#4b5563;">${escapeHtml(l.where)}</span>` : ''}</td></tr>`).join('') +
    `<tr><td style="padding:12px 16px;background:#fff7e6;font-size:14px;line-height:1.55;color:#7a5200;">${escapeHtml(PAY_IN_PERSON)}</td></tr>` +
    `</table>`
}
function nextScreeningText(f: FilmBlock | null) {
  if (!f) return '  Our next monthly screening will be announced soon — you can always join and pay in person at any of our monthly screenings.'
  return `  ${f.title}\n` + showtimeLines(f).map((l) => `  • ${l.when}${l.where ? ` — ${l.where}` : ''}`).join('\n') + `\n  ${PAY_IN_PERSON}`
}

// Other upcoming screenings (the next monthly one is shown on its own).
// Carries its own heading and renders nothing when there aren't any.
function filmsHtml(films: FilmBlock[]) {
  if (!films.length) return ''
  return `<div style="margin:4px 0 6px;">Also coming up:</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">` +
    films.map((f) => `<tr><td style="padding:10px 14px;border-left:4px solid ${BRAND};background:#f4f6f9;border-radius:6px;"><a href="${SITE_URL}/film/${f.id}" style="color:#12283f;font-weight:bold;text-decoration:none;font-size:16px;">${escapeHtml(f.title)}</a><br/><span style="color:${BRAND};font-weight:bold;font-size:14px;">${escapeHtml(f.range)}</span>${f.places ? `<span style="color:#6b7280;font-size:14px;"> &middot; ${escapeHtml(f.places)}</span>` : ''}</td></tr><tr><td style="height:8px;"></td></tr>`).join('') +
    `</table>`
}
function filmsText(films: FilmBlock[]) {
  if (!films.length) return ''
  return 'Also coming up:\n' + films.map((f) => `  • ${f.title} — ${f.range}${f.places ? ` (${f.places})` : ''}`).join('\n')
}
function joinButtonHtml(url: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;"><tr><td align="center">` +
    `<a href="${url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:15px 34px;border-radius:8px;">Join Footcandle Film Society</a>` +
    `</td></tr></table>`
}

// Render a template for one prospect. Returns the inner HTML (wrap with
// renderEmail to preview), the full branded HTML, and a plain-text version.
export async function renderInvite(t: Template, p: { name: string; joinUrl: string }) {
  const films = await upcomingFilms()
  const standard = nextStandard(films)
  const others = films.filter((f) => f !== standard).slice(0, 3)
  const first = (p.name || '').trim().split(/\s+/)[0] || 'there'
  const blocksHtml: Record<string, string> = { next_screening: nextScreeningHtml(standard), benefits: benefitsHtml(), dues: duesHtml(), upcoming_screenings: filmsHtml(others), join_button: joinButtonHtml(p.joinUrl) }
  const blocksText: Record<string, string> = { next_screening: nextScreeningText(standard), benefits: benefitsText(), dues: duesText(), upcoming_screenings: filmsText(others), join_button: `Join here: ${p.joinUrl}` }
  const inline: Record<string, string> = { first_name: first, name: (p.name || '').trim() || first, join_link: p.joinUrl }

  // Block fields replace their whole line (and swallow the line break after
  // them) so they don't leave stray gaps; inline fields are escaped text.
  let html = escapeHtml(t.body)
  html = html.replace(/\{\{(next_screening|benefits|dues|upcoming_screenings|join_button)\}\}\n?/g, (_m, k) => `\u0000${k}\u0000`)
  html = html.replace(/\{\{(first_name|name|join_link)\}\}/g, (_m, k) => escapeHtml(inline[k]))
  html = html.replace(/\n/g, '<br/>')
  html = html.replace(/\u0000(\w+)\u0000/g, (_m, k) => blocksHtml[k] ?? '')

  let text = t.body.replace(/\{\{(next_screening|benefits|dues|upcoming_screenings|join_button)\}\}/g, (_m, k) => blocksText[k])
  text = text.replace(/\{\{(first_name|name|join_link)\}\}/g, (_m, k) => inline[k])
  const subject = t.subject.replace(/\{\{(first_name|name)\}\}/g, (_m, k) => inline[k])
  return { subject, inner: html, html: renderEmail(html), text }
}

// Send one template to one prospect through the normal queue (so it shows in
// the Email Queue and the person's email history). The body is fully
// personalized before queueing, so the send engine has nothing left to merge.
export async function sendInviteEmail(key: TemplateKey, p: Prospect) {
  const t = await getTemplate(key)
  const r = await renderInvite(t, { name: p.name, joinUrl: joinUrl(p.id) })
  const id = await queueEmail({ email_type: key, recipient_email: p.email, subject: r.subject, body: r.text, html_body: r.inner, metadata: { auto: true, inquiry_id: p.id } })
  await sendQueued(id)
}

// Emails (lowercased) that already belong to an active member.
export async function activeMemberEmails(emails: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const list = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))))
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await admin().from('members').select('email').eq('status', 'active').in('email', list.slice(i, i + 200))
    for (const m of data || []) if (m.email) out.add(String(m.email).toLowerCase())
  }
  return out
}

// Daily (from the renewal-reminders cron): one follow-up to anyone invited
// FOLLOWUP_DAYS+ ago who hasn't joined, isn't marked handled, and hasn't had
// one yet. Anyone found to have joined in the meantime is marked joined.
export async function sendInviteFollowups() {
  const cutoff = new Date(Date.now() - FOLLOWUP_DAYS * 86400000).toISOString()
  const { data, error } = await admin().from('membership_inquiries')
    .select('id,name,email').eq('handled', false).is('joined_at', null).is('followup_sent_at', null)
    .not('invited_at', 'is', null).lte('invited_at', cutoff)
  if (error) throw new Error(error.message)
  const due = data || []
  const members = await activeMemberEmails(due.map((d: any) => d.email))
  let sent = 0, joined = 0
  const failed: string[] = []
  for (const p of due as Prospect[]) {
    if (members.has(p.email.toLowerCase())) {
      await admin().from('membership_inquiries').update({ joined_at: new Date().toISOString() }).eq('id', p.id)
      joined++
      continue
    }
    try {
      await sendInviteEmail('membership_invite_followup', p)
      await admin().from('membership_inquiries').update({ followup_sent_at: new Date().toISOString() }).eq('id', p.id)
      sent++
    } catch (e) {
      failed.push(`${p.email}: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }
  return { due: due.length, sent, joined, failed }
}
