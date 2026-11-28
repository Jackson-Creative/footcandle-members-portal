'use client'

// Admin: the new-member funnel. Prospects come from the public "Become a
// Member" form or a pasted list; an admin reviews them and sends the standard
// invitation (personal join link). People who haven't joined get one
// follow-up automatically after 10 days; anyone who pays shows as Joined.
// The invitation + follow-up text is editable at the bottom of the page.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Check, Eye, Mail, RefreshCw, Send, UserPlus } from 'lucide-react'

type Inquiry = {
  id: string; name: string; email: string; message: string | null; handled: boolean; created_at: string
  source?: string | null; invited_at?: string | null; followup_sent_at?: string | null; joined_at?: string | null; is_member?: boolean
}
type Key = 'membership_invite' | 'membership_invite_followup'
type Tpl = { subject: string; body: string; isDefault: boolean }

const BRAND = '#2a5680'
const FIELD_HELP: Record<string, string> = {
  first_name: 'their first name', name: 'their full name', benefits: 'membership benefits list',
  next_screening: 'next monthly screening + “pay in person” note (required in the invitation)',
  dues: 'annual dues table', upcoming_screenings: 'other upcoming screenings (hidden if none)', join_button: 'the “Join” button (required)', join_link: 'the join link as text',
}

function fmt(d?: string | null) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '' }
function plusDays(d: string, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString() }

// "Jane Smith, jane@x.com" · "Jane Smith <jane@x.com>" · "jane@x.com" · tab-separated (spreadsheet paste)
function parseList(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const email = (line.match(/[^\s<>,;"']+@[^\s<>,;"']+/) || [''])[0]
    const name = line.replace(email, '').replace(/[<>"\t,;]+/g, ' ').replace(/\s+/g, ' ').trim()
    return { name, email }
  })
}

export default function MembershipInquiriesAdmin() {
  const [items, setItems] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [setupNeeded, setSetupNeeded] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [followupDays, setFollowupDays] = useState(10)
  const [templates, setTemplates] = useState<Record<Key, Tpl> | null>(null)
  const [fields, setFields] = useState<string[]>([])
  const [editKey, setEditKey] = useState<Key>('membership_invite')
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: '', body: '' })
  const [testEmail, setTestEmail] = useState('')
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const u = await supabase.auth.getUser()
      if (!u.data.user) { window.location.href = '/login'; return }
      setTestEmail(u.data.user.email || '')
      await Promise.all([load(), loadTemplates()])
    })()
  }, [])

  async function token() {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ''
  }
  async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}`, ...(init?.headers || {}) } })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return json
  }
  const post = (body: any) => api('/api/admin/membership-invites', { method: 'POST', body: JSON.stringify(body) })

  async function load() {
    setLoading(true)
    try {
      const json = await api('/api/membership-inquiries')
      setItems(json.inquiries || [])
      setSelected(new Set())
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not load', ok: false })
    } finally {
      setLoading(false)
    }
  }
  async function loadTemplates() {
    try {
      const json = await api('/api/admin/membership-invites')
      setTemplates(json.templates)
      setFields(json.fields || [])
      setFollowupDays(json.followupDays || 10)
      setSetupNeeded(json.setupNeeded || '')
      setDraft({ subject: json.templates[editKey].subject, body: json.templates[editKey].body })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not load the invitation text', ok: false })
    }
  }

  // Funnel stages. Joined wins over everything; handled = closed by an admin.
  const groups = useMemo(() => {
    const joined = items.filter((i) => i.is_member || i.joined_at)
    const rest = items.filter((i) => !(i.is_member || i.joined_at))
    return {
      fresh: rest.filter((i) => !i.handled && !i.invited_at),
      invited: rest.filter((i) => !i.handled && i.invited_at),
      joined,
      closed: rest.filter((i) => i.handled),
    }
  }, [items])

  async function toggleHandled(it: Inquiry) {
    try {
      await api('/api/membership-inquiries', { method: 'PATCH', body: JSON.stringify({ id: it.id, handled: !it.handled }) })
      setItems((p) => p.map((x) => (x.id === it.id ? { ...x, handled: !x.handled } : x)))
    } catch {
      setMsg({ text: 'Could not update.', ok: false })
    }
  }

  async function invite(ids: string[], label: string) {
    if (!ids.length) return
    if (!confirm(`Send the membership invitation to ${label}?`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await post({ action: 'send', ids })
      const parts = [`✓ Invitation sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`]
      if (r.alreadyMembers) parts.push(`${r.alreadyMembers} already ${r.alreadyMembers === 1 ? 'is a member' : 'are members'} (marked Joined, not emailed).`)
      if (r.failed?.length) parts.push(`Failed: ${r.failed.join('; ')}`)
      setMsg({ text: parts.join(' '), ok: !r.failed?.length })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Send failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  const parsed = useMemo(() => parseList(paste), [paste])
  async function importList() {
    if (!parsed.length) return
    setBusy(true); setMsg(null)
    try {
      const r = await post({ action: 'import', rows: parsed })
      const parts = [`✓ Added ${r.added} ${r.added === 1 ? 'person' : 'people'} to “New”.`]
      if (r.skippedMembers) parts.push(`${r.skippedMembers} skipped (already members).`)
      if (r.skippedDuplicates) parts.push(`${r.skippedDuplicates} skipped (already on this list).`)
      if (r.invalid) parts.push(`${r.invalid} line(s) had no valid email.`)
      setMsg({ text: parts.join(' '), ok: true })
      setPaste('')
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Import failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  function switchTemplate(k: Key) {
    setEditKey(k)
    if (templates) setDraft({ subject: templates[k].subject, body: templates[k].body })
  }
  const dirty = !!templates && (draft.subject !== templates[editKey].subject || draft.body !== templates[editKey].body)

  async function tplAction(action: 'save' | 'reset' | 'preview' | 'test') {
    if (action === 'reset' && !confirm('Reset this email to the original standard text? Your edits will be lost.')) return
    setBusy(true); setMsg(null)
    try {
      const r = await post({ action, key: editKey, subject: draft.subject, body: draft.body, email: testEmail })
      if (action === 'preview') { setPreview({ subject: r.subject, html: r.html }); return }
      if (action === 'test') { setMsg({ text: `✓ Test sent to ${r.to}.`, ok: true }); return }
      if (action === 'reset') setDraft({ subject: r.template.subject, body: r.template.body })
      setMsg({ text: action === 'save' ? '✓ Saved — every invitation from now on uses this text.' : '✓ Reset to the standard text.', ok: true })
      await loadTemplates()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !items.length) return <div style={s.loading}>Loading inquiries…</div>

  const freshIds = groups.fresh.map((i) => i.id)
  const selectedFresh = freshIds.filter((id) => selected.has(id))
  const toggleSel = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div style={s.container}>
      <header style={s.header}>
        <Link href="/admin" style={s.backLink}><ArrowLeft size={20} /> Back to Admin</Link>
        <h1 style={{ fontSize: 22 }}>Membership Inquiries</h1>
        <button onClick={load} style={s.refresh} title="Reload"><RefreshCw size={16} /></button>
      </header>

      <main style={s.main}>
        <p style={s.intro}>
          People interested in joining — from the website’s “Become a Member” form, or added from a list below. Review each one and
          send the standard invitation; it has a personal <strong>Join</strong> link that pre-fills their sign-up and payment. Anyone who
          hasn’t joined gets one automatic follow-up {followupDays} days later. When someone pays, they’re added to the member list and
          show here as <strong>Joined</strong>.
        </p>
        {setupNeeded && <div style={s.error}>{setupNeeded}</div>}
        {msg && <div style={msg.ok ? s.success : s.error}>{msg.text}</div>}

        {/* NEW */}
        <div style={s.groupHead}>
          <h2 style={s.sectionTitle}>New — not yet invited ({groups.fresh.length})</h2>
          {groups.fresh.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={s.ghostBtn} onClick={() => setSelected(selectedFresh.length === freshIds.length ? new Set() : new Set(freshIds))}>
                {selectedFresh.length === freshIds.length ? 'Clear selection' : 'Select all'}
              </button>
              <button style={{ ...s.primaryBtn, opacity: busy || !selectedFresh.length ? 0.5 : 1 }} disabled={busy || !selectedFresh.length}
                onClick={() => invite(selectedFresh, `${selectedFresh.length} selected ${selectedFresh.length === 1 ? 'person' : 'people'}`)}>
                <Send size={14} /> Invite selected ({selectedFresh.length})
              </button>
            </div>
          )}
        </div>
        {groups.fresh.length === 0 ? <div style={s.empty}>No one waiting for an invitation.</div> : groups.fresh.map((it) => (
          <Row key={it.id} it={it} selectable selected={selected.has(it.id)} onSelect={() => toggleSel(it.id)}
            actions={<>
              <button style={s.primaryBtn} disabled={busy} onClick={() => invite([it.id], `${it.name} (${it.email})`)}><Send size={14} /> Send invitation</button>
              <button style={s.handleBtn} onClick={() => toggleHandled(it)} title="Close without inviting (e.g. spam)">Dismiss</button>
            </>} />
        ))}

        {/* INVITED */}
        <h2 style={{ ...s.sectionTitle, marginTop: 28 }}>Invited — waiting to join ({groups.invited.length})</h2>
        {groups.invited.length === 0 ? <div style={s.empty}>No outstanding invitations.</div> : groups.invited.map((it) => (
          <Row key={it.id} it={it}
            status={<>Invited {fmt(it.invited_at)} · {it.followup_sent_at ? `follow-up sent ${fmt(it.followup_sent_at)}` : `follow-up ${fmt(plusDays(it.invited_at!, followupDays))} if not joined`}</>}
            actions={<>
              <button style={s.ghostBtn} disabled={busy} onClick={() => invite([it.id], `${it.name} again`)}><Send size={14} /> Resend</button>
              <button style={s.handleBtn} onClick={() => toggleHandled(it)} title="Stop following up">Close</button>
            </>} />
        ))}

        {/* JOINED */}
        {groups.joined.length > 0 && <>
          <h2 style={{ ...s.sectionTitle, marginTop: 28, color: '#065f46' }}>Joined ({groups.joined.length})</h2>
          {groups.joined.map((it) => <Row key={it.id} it={it} status={<span style={{ color: '#065f46', fontWeight: 700 }}>✓ Member{it.joined_at ? ` since ${fmt(it.joined_at)}` : ''}</span>} />)}
        </>}

        {/* CLOSED */}
        {groups.closed.length > 0 && <>
          <h2 style={{ ...s.sectionTitle, marginTop: 28, opacity: 0.7 }}>Closed / dismissed ({groups.closed.length})</h2>
          {groups.closed.map((it) => <Row key={it.id} it={it} muted status={it.invited_at ? <>Invited {fmt(it.invited_at)}</> : undefined}
            actions={<button style={s.handleBtn} onClick={() => toggleHandled(it)}>Reopen</button>} />)}
        </>}

        {/* ADD PEOPLE */}
        <section style={s.panel}>
          <h2 style={s.panelTitle}><UserPlus size={18} /> Add people from a list</h2>
          <p style={s.panelHelp}>Paste one person per line — <code>Jane Smith, jane@example.com</code>, <code>Jane Smith &lt;jane@example.com&gt;</code>, just an email, or two columns copied from a spreadsheet. They’re added to “New” (nothing is emailed yet). Current members and people already on this list are skipped.</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} style={s.textarea} placeholder={'Jane Smith, jane@example.com\nJohn Doe <john@example.com>'} />
          {parsed.length > 0 && <p style={{ fontSize: 13, color: '#6b7280', margin: '6px 0 10px' }}>{parsed.filter((p) => p.email).length} with an email{parsed.some((p) => !p.email) ? ` · ${parsed.filter((p) => !p.email).length} line(s) with no email will be skipped` : ''}</p>}
          <button style={{ ...s.primaryBtn, opacity: busy || !parsed.length ? 0.5 : 1 }} disabled={busy || !parsed.length} onClick={importList}><UserPlus size={14} /> Add to list</button>
        </section>

        {/* EDIT TEXT */}
        <section style={s.panel}>
          <h2 style={s.panelTitle}><Mail size={18} /> Invitation email text</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['membership_invite', 'membership_invite_followup'] as Key[]).map((k) => (
              <button key={k} onClick={() => switchTemplate(k)} style={{ ...s.tab, ...(editKey === k ? s.tabOn : {}) }}>
                {k === 'membership_invite' ? 'Invitation' : `${followupDays}-day follow-up`}
                {templates && !templates[k].isDefault ? ' (edited)' : ''}
              </button>
            ))}
          </div>
          <label style={s.label}>Subject</label>
          <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} style={s.input} />
          <label style={s.label}>Message</label>
          <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} rows={18} style={{ ...s.textarea, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} />
          <div style={{ fontSize: 12.5, color: '#6b7280', margin: '8px 0 14px', lineHeight: 1.7 }}>
            Fill-ins (filled in automatically for each person when it sends):{' '}
            {fields.map((f) => <span key={f} style={{ display: 'inline-block', marginRight: 14 }}><code style={{ whiteSpace: 'nowrap' }}>{`{{${f}}}`}</code> {FIELD_HELP[f] || ''}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...s.primaryBtn, opacity: busy || !dirty ? 0.5 : 1 }} disabled={busy || !dirty} onClick={() => tplAction('save')}><Check size={14} /> Save</button>
            <button style={s.ghostBtn} disabled={busy} onClick={() => tplAction('preview')}><Eye size={14} /> Preview</button>
            <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="test@email" style={{ ...s.input, width: 210, margin: 0 }} />
            <button style={s.ghostBtn} disabled={busy} onClick={() => tplAction('test')}><Send size={14} /> Send test</button>
            {templates && !templates[editKey].isDefault && <button style={{ ...s.handleBtn, marginLeft: 'auto' }} disabled={busy} onClick={() => tplAction('reset')}>Reset to standard text</button>}
          </div>
          {dirty && <p style={{ fontSize: 12.5, color: '#8a5a00', marginTop: 8 }}>Unsaved changes — Preview and Send test use what’s in the box; invitations use the saved text.</p>}
        </section>
      </main>

      {preview && (
        <div onClick={() => setPreview(null)} style={s.modalBg}>
          <div onClick={(e) => e.stopPropagation()} style={s.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 14 }}><strong>Subject:</strong> {preview.subject} <span style={{ color: '#9ca3af' }}>· sample recipient “Jane Smith”</span></div>
              <button onClick={() => setPreview(null)} style={s.ghostBtn}>Close</button>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} style={{ width: '100%', height: '75vh', border: 0 }} />
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ it, muted, status, actions, selectable, selected, onSelect }: {
  it: Inquiry; muted?: boolean; status?: React.ReactNode; actions?: React.ReactNode; selectable?: boolean; selected?: boolean; onSelect?: () => void
}) {
  return (
    <div style={{ ...s.row, opacity: muted ? 0.65 : 1 }}>
      {selectable && <input type="checkbox" checked={!!selected} onChange={onSelect} style={{ width: 18, height: 18, flexShrink: 0, accentColor: BRAND }} aria-label={`Select ${it.name}`} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#1f2937' }}>{it.name}{it.source === 'import' && <span style={s.tag}>added from list</span>}</div>
        <a href={`mailto:${it.email}`} style={{ color: BRAND, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={13} /> {it.email}</a>
        {it.message && <p style={{ marginTop: 6, color: '#4b5563', fontSize: 14 }}>{it.message}</p>}
        <p style={{ marginTop: 4, color: '#9ca3af', fontSize: 12 }}>Added {fmt(it.created_at)}{status ? <> · <span style={{ color: '#4b5563' }}>{status}</span></> : null}</p>
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>{actions}</div>}
    </div>
  )
}

const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }
const s: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f9fafb' },
  header: { background: 'linear-gradient(135deg, #2a5680 0%, #1e3f5f 100%)', color: 'white', padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backLink: { display: 'flex', alignItems: 'center', gap: 8, color: 'white', textDecoration: 'none' },
  refresh: { background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: 6, padding: 8, cursor: 'pointer' },
  main: { maxWidth: 880, margin: '32px auto', padding: '0 20px 60px' },
  intro: { color: '#6b7280', fontSize: 14, marginBottom: 16, lineHeight: 1.6 },
  groupHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  sectionTitle: { fontSize: 16, color: '#374151', marginBottom: 12, fontWeight: 700 },
  row: { background: 'white', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  primaryBtn: { ...btn, background: BRAND, color: '#fff', border: `1px solid ${BRAND}` },
  ghostBtn: { ...btn, background: '#fff', color: BRAND, border: '1px solid #cfd8e3' },
  handleBtn: { ...btn, background: '#eef3f8', color: BRAND, border: '1px solid #cfd8e3' },
  tag: { marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', borderRadius: 4, padding: '1px 6px', verticalAlign: 2 },
  empty: { border: '1px dashed #d1d5db', borderRadius: 10, padding: 24, color: '#9ca3af', textAlign: 'center', fontSize: 14 },
  error: { padding: '12px 14px', borderRadius: 8, background: '#fee2e2', color: '#7f1d1d', fontSize: 14, marginBottom: 16 },
  success: { padding: '12px 14px', borderRadius: 8, background: '#d1fae5', color: '#065f46', fontSize: 14, marginBottom: 16 },
  panel: { background: 'white', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: 20, marginTop: 32 },
  panelTitle: { fontSize: 17, fontWeight: 700, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  panelHelp: { fontSize: 13.5, color: '#6b7280', lineHeight: 1.55, marginBottom: 12 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', margin: '10px 0 6px' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 4 },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, lineHeight: 1.5, resize: 'vertical' },
  tab: { ...btn, background: '#fff', color: '#374151', border: '1px solid #d1d5db' },
  tabOn: { background: '#eef3f8', color: BRAND, borderColor: BRAND },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 },
  modal: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 760, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontSize: 18, color: '#6b7280' },
}
