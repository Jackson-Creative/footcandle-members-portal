'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Send, Trash2, Pencil, Save, X, Mail, Eye } from 'lucide-react'

interface Email {
  id: string
  email_type: string
  subject: string
  body: string
  html_body: string | null
  status: string
  recipient_email: string | null
  recipient_filter: string | null
  created_at: string
  metadata?: any
}

const AUDIENCE_LABELS: Record<string, string> = {
  all_members: 'All members', all_active: 'Active members', all_expired: 'Expired members',
  expired_12mo: 'Expired in last 12 months', expired_12mo_not_recent: 'Expired 12 mo (not last 30 days)',
  expired_last_30: 'Expired in last 30 days',
}

export default function EmailQueueAdmin() {
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null)

  const handlePreview = async (id: string) => {
    setBusy(true); setMessage('Loading preview…')
    try {
      const res = await fetch(`/api/email-preview?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load preview')
      setPreview({ html: json.html, subject: json.subject }); setMessage('')
    } catch (err) { setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`) } finally { setBusy(false) }
  }

  useEffect(() => {
    loadEmails()
    supabase.auth.getUser().then((u) => setAdminEmail(u.data.user?.email || ''))
  }, [])

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token || '' }

  const handleTest = async (id: string) => {
    const to = prompt('Send a test copy of this email to which address?', adminEmail)
    if (!to) return
    setBusy(true); setMessage('Sending test…')
    try {
      const res = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id, testEmail: to }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Test failed')
      setMessage(`✓ Test sent to ${to}. (The draft was not sent to anyone else.)`)
    } catch (err) { setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`) } finally { setBusy(false) }
  }

  const loadEmails = async () => {
    try {
      const { data, error } = await supabase.from('email_queue').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setEmails(data || [])
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setLoading(false) }
  }

  function startEdit(e: Email) {
    setEditId(e.id); setEditSubject(e.subject || ''); setEditBody(e.body || ''); setMessage('')
  }
  function cancelEdit() { setEditId(null); setEditSubject(''); setEditBody('') }

  async function saveEdit(id: string) {
    if (!editSubject.trim() || !editBody.trim()) { setMessage('Subject and message are required.'); return }
    setBusy(true); setMessage('')
    try {
      const res = await fetch('/api/email-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id, updates: { subject: editSubject, body: editBody } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Save failed')
      cancelEdit(); await loadEmails(); setMessage('✓ Draft updated.')
    } catch (err) { setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`) } finally { setBusy(false) }
  }

  const handleSend = async (id: string) => {
    if (!confirm('Send this email to its recipients now? This delivers real email via Brevo.')) return
    setBusy(true); setMessage('Sending…')
    try {
      const res = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Send failed')
      setMessage(`✓ Sent to ${json.sent} recipient${json.sent === 1 ? '' : 's'}.`)
      await loadEmails()
    } catch (err) { setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`) } finally { setBusy(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this email from the queue?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/email-queue?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } })
      if (!res.ok) throw new Error()
      await loadEmails()
    } catch { setMessage('Could not delete.') } finally { setBusy(false) }
  }

  function audienceOf(e: Email) {
    if (e.recipient_filter && AUDIENCE_LABELS[e.recipient_filter]) return AUDIENCE_LABELS[e.recipient_filter]
    if (e.recipient_email) { const n = e.recipient_email.split(/[,;]/).filter((x) => x.includes('@')).length; return n === 1 ? e.recipient_email : `${n} recipients` }
    return e.recipient_filter || '—'
  }

  if (loading) return <div style={styles.loading}>Loading emails...</div>

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <Link href="/admin" style={styles.backLink}><ArrowLeft size={20} /> Back to Admin</Link>
        <h1>Email Queue</h1>
        <div style={{ width: 110 }} />
      </header>

      <main style={styles.main}>
        {message && <div style={{ ...styles.message, background: message.includes('Error') || message.includes('Could') ? '#fee2e2' : '#d1fae5', color: message.includes('Error') || message.includes('Could') ? '#7f1d1d' : '#065f46' }}>{message}</div>}

        {emails.length === 0 ? <p style={styles.noData}>No emails in queue.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {emails.map((email) => (
              <div key={email.id} style={styles.card}>
                {editId === email.id ? (
                  <div>
                    <label style={styles.lbl}>Subject</label>
                    <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} style={styles.input} />
                    <label style={{ ...styles.lbl, marginTop: 12 }}>Message</label>
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} style={{ ...styles.input, minHeight: 220, resize: 'vertical', fontFamily: 'inherit' }} />
                    <p style={styles.hint}>Personalized fields like <code>{'{{first_name}}'}</code> and the <code>{'{{renew_button}}'}</code> still work here.</p>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button onClick={() => saveEdit(email.id)} disabled={busy} style={styles.saveBtn}><Save size={16} /> Save draft</button>
                      <button onClick={cancelEdit} style={styles.cancelBtn}><X size={16} /> Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ ...styles.statusPill, ...(email.status === 'sent' ? styles.sentPill : email.status === 'failed' ? styles.failPill : styles.draftPill) }}>{email.status}</span>
                          <span style={styles.type}>{email.email_type.replace(/_/g, ' ')}</span>
                          <span style={styles.audience}>→ {audienceOf(email)}</span>
                        </div>
                        <p style={styles.subject}>{email.subject}</p>
                        <p style={styles.preview}>{(email.body || '').replace(/\s+/g, ' ').slice(0, 160)}{(email.body || '').length > 160 ? '…' : ''}</p>
                        <p style={styles.date}>{new Date(email.created_at).toLocaleString()}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button onClick={() => handlePreview(email.id)} disabled={busy} style={styles.previewBtn} title="Preview this email"><Eye size={15} /> Preview</button>
                        <button onClick={() => handleTest(email.id)} disabled={busy} style={styles.testBtn} title="Send a test copy to yourself"><Mail size={15} /> Send test</button>
                        {email.status === 'draft' && <>
                          {!email.html_body && <button onClick={() => startEdit(email)} style={styles.editBtn} title="Edit draft"><Pencil size={15} /> Edit</button>}
                          <button onClick={() => handleSend(email.id)} disabled={busy} style={styles.sendBtn}><Send size={15} /> Send</button>
                        </>}
                        <button onClick={() => handleDelete(email.id)} disabled={busy} style={styles.deleteBtn} title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {preview && (
        <div style={styles.overlay} onClick={() => setPreview(null)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Preview — {preview.subject}</span>
              <button onClick={() => setPreview(null)} style={styles.iconBtn} title="Close"><X size={18} /></button>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} style={styles.iframe} />
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f9fafb' },
  header: { background: 'linear-gradient(135deg, #2a5680 0%, #1e3f5f 100%)', color: 'white', padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  backLink: { display: 'flex', alignItems: 'center', gap: 8, color: 'white', textDecoration: 'none' },
  main: { maxWidth: 860, margin: '32px auto', padding: '0 20px' },
  card: { background: 'white', borderRadius: 10, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  statusPill: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999 },
  draftPill: { background: '#fef3c7', color: '#92400e' },
  sentPill: { background: '#d1fae5', color: '#065f46' },
  failPill: { background: '#fee2e2', color: '#7f1d1d' },
  type: { fontSize: 12, color: '#6b7280', textTransform: 'capitalize' },
  audience: { fontSize: 12, color: '#2a5680', fontWeight: 600 },
  subject: { fontSize: 16, fontWeight: 700, color: '#1f2937', margin: '8px 0 4px' },
  preview: { fontSize: 13, color: '#6b7280', margin: 0 },
  date: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  lbl: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 8 },
  editBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#eef3f8', color: '#2a5680', border: '1px solid #cfd8e3', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  testBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  previewBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#eef3f8', color: '#2a5680', border: '1px solid #cfd8e3', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 },
  modalBox: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 680, height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: '1px solid #e5e7eb' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', flexShrink: 0 },
  iframe: { flex: 1, width: '100%', border: 'none', background: '#f4f6f9' },
  sendBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  cancelBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  deleteBtn: { display: 'inline-flex', alignItems: 'center', padding: '7px 10px', background: '#fee2e2', color: '#7f1d1d', border: 'none', borderRadius: 6, cursor: 'pointer' },
  message: { padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  noData: { color: '#9ca3af', fontStyle: 'italic' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
}
