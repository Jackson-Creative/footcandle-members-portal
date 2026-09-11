'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, CreditCard, Mail, RotateCcw, ExternalLink } from 'lucide-react'

type Payment = {
  id: string; payment_intent: string | null; created: number; amount_cents: number; currency: string
  status: string; paid: boolean; refunded: boolean; amount_refunded_cents: number; description: string | null
  receipt_url: string | null; membership_type: string | null; is_subscription: boolean | null
  can_auto_revert: boolean; reverted_on_refund: boolean
}
type EmailRow = { id: string; subject: string | null; email_type: string | null; sent_at: string; source: string; email: string }
type Member = { id: string; full_name: string; email: string | null; status: string | null; membership_type: string | null; renewal_date: string | null; expired_date: string | null; autorenew: boolean }

function money(cents: number, cur = 'usd') { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100) }
function dt(unixOrIso: number | string) {
  const d = typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtDate(s: string | null) { return s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—' }
const TYPE_LABEL: Record<string, string> = {
  newsletter: 'Newsletter', promo: 'Announcement', renewal_reminder: 'Renewal reminder',
  monthly_digest: 'Monthly digest', renewal_confirmation: 'Renewal confirmation', announcement: 'Announcement',
}

export default function MemberDetail() {
  const params = useParams()
  const id = String(params?.id || '')
  const [member, setMember] = useState<Member | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [emails, setEmails] = useState<EmailRow[]>([])
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token || '' }

  async function load() {
    setLoading(true); setMsg(null)
    const { data: m } = await supabase.from('members').select('*').eq('id', id).maybeSingle()
    setMember(m as Member)
    try {
      const res = await fetch(`/api/admin/member-history?memberId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load history')
      setPayments(json.payments || []); setEmails(json.emails || []); setStripeError(json.stripeError || null)
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed to load history', ok: false }) }
    setLoading(false)
  }

  useEffect(() => {
    ;(async () => {
      const u = await supabase.auth.getUser()
      if (!u.data.user) { window.location.href = '/login'; return }
      if (id) await load()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function refund(p: Payment) {
    const restores = p.can_auto_revert
    const warn = `Refund ${money(p.amount_refunded_cents ? p.amount_cents - p.amount_refunded_cents : p.amount_cents, p.currency)} to ${member?.full_name || 'this member'}?\n\n`
      + `This issues a REAL Stripe refund.\n`
      + (restores
          ? `Their membership will be restored to its state before this payment (auto-renew is left unchanged).`
          : `We have no saved snapshot for this payment, so the membership record will NOT be changed automatically — adjust it by hand if needed.`)
      + `\n\nThis cannot be undone.`
    if (!confirm(warn)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/refund', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ paymentIntentId: p.payment_intent, chargeId: p.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Refund failed')
      setMsg({ text: json.membershipAdjusted ? `Refunded ${money(json.amount_refunded_cents, p.currency)} and restored the membership.` : (json.note || 'Refund processed.'), ok: true })
      await load()
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Refund failed', ok: false }) } finally { setBusy(false) }
  }

  if (loading) return <div style={s.loading}>Loading…</div>

  return (
    <div style={s.container}>
      <header style={s.header}>
        <Link href="/admin/members" style={s.backLink}><ArrowLeft size={20} /> Back to Members</Link>
        <h1 style={{ fontSize: 20 }}>{member?.full_name || 'Member'}</h1>
        <button onClick={load} style={s.ghostBtn} title="Reload"><RefreshCw size={16} /></button>
      </header>

      <main style={s.main}>
        {msg && <div style={{ ...s.message, background: msg.ok ? '#d1fae5' : '#fee2e2', color: msg.ok ? '#065f46' : '#7f1d1d' }}>{msg.text}</div>}

        {/* Membership summary */}
        <section style={s.card}>
          <div style={s.summaryGrid}>
            <Field label="Email" value={member?.email || '—'} />
            <Field label="Status" value={member?.status || '—'} />
            <Field label="Type" value={member?.membership_type || '—'} />
            <Field label="Renews / expires" value={fmtDate(member?.renewal_date || null)} />
            <Field label="Auto-renew" value={member?.autorenew ? 'On' : 'Off'} />
          </div>
          <Link href="/admin/members" style={s.smallLink}>Edit this member in the Members list →</Link>
        </section>

        {/* Payments */}
        <section style={s.card}>
          <h2 style={s.h2}><CreditCard size={18} /> Order &amp; Payment History</h2>
          {stripeError && <p style={s.warn}>Couldn’t reach Stripe: {stripeError}</p>}
          {payments.length === 0 ? (
            <p style={s.empty}>No online payments on record.{' '}
              <span style={{ color: '#9ca3af' }}>In-person “Mark renewed” renewals aren’t recorded as orders.</span>
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Date &amp; time</th><th style={s.th}>Amount</th><th style={s.th}>Type</th><th style={s.th}>Status</th><th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {payments.map((p) => {
                    const fullyRefunded = p.refunded || (p.amount_refunded_cents >= p.amount_cents && p.amount_cents > 0)
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={s.td}>{dt(p.created)}</td>
                        <td style={s.td}>{money(p.amount_cents, p.currency)}{p.is_subscription ? <span style={s.tag}>auto-renew</span> : null}</td>
                        <td style={{ ...s.td, color: '#6b7280' }}>{p.membership_type || p.description || '—'}</td>
                        <td style={s.td}>
                          {fullyRefunded
                            ? <span style={{ ...s.pill, background: '#fee2e2', color: '#991b1b' }}>Refunded</span>
                            : p.amount_refunded_cents > 0
                              ? <span style={{ ...s.pill, background: '#fef3c7', color: '#92400e' }}>Partial refund</span>
                              : <span style={{ ...s.pill, background: '#d1fae5', color: '#065f46' }}>Paid</span>}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {p.receipt_url && <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" style={s.linkBtn} title="Stripe receipt"><ExternalLink size={13} /></a>}
                          {!fullyRefunded && <button onClick={() => refund(p)} disabled={busy} style={s.refundBtn} title="Refund this payment"><RotateCcw size={13} /> Refund</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Emails */}
        <section style={s.card}>
          <h2 style={s.h2}><Mail size={18} /> Email History <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: 13 }}>({emails.length})</span></h2>
          {emails.length === 0 ? (
            <p style={s.empty}>No emails recorded yet for this member.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {emails.map((e) => (
                <div key={e.id} style={s.emailRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject || '(no subject)'}</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                      {TYPE_LABEL[e.email_type || ''] || e.email_type || 'Email'} · {dt(e.sent_at)}
                      {e.source === 'backfill' && <span style={s.tag}>reconstructed</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{label}</div><div style={{ fontSize: 15, color: '#1f2937', marginTop: 2, textTransform: label === 'Status' ? 'capitalize' : 'none' }}>{value}</div></div>
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f9fafb' },
  header: { background: 'linear-gradient(135deg, #2a5680 0%, #1e3f5f 100%)', color: 'white', padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backLink: { display: 'flex', alignItems: 'center', gap: 8, color: 'white', textDecoration: 'none' },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' },
  main: { maxWidth: 900, margin: '28px auto', padding: '0 20px' },
  card: { background: 'white', borderRadius: 12, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: '#12283f' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  td: { padding: '10px', color: '#1f2937', verticalAlign: 'top' as const },
  pill: { fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 10px' },
  tag: { fontSize: 11, fontWeight: 700, color: '#3730a3', background: '#e0e7ff', borderRadius: 5, padding: '1px 6px', marginLeft: 8, whiteSpace: 'nowrap' },
  refundBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', background: '#fff', color: '#b91c1c', border: '1px solid #f0b4b4', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  linkBtn: { display: 'inline-flex', alignItems: 'center', color: '#2563eb', marginRight: 10, textDecoration: 'none' },
  smallLink: { fontSize: 13, color: '#2a5680', fontWeight: 600, textDecoration: 'none' },
  emailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 14px' },
  empty: { color: '#6b7280', fontSize: 14 },
  warn: { color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  message: { padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontSize: 18, color: '#6b7280' },
}
