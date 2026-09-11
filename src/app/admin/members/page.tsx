'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Member } from '@/types'
import Link from 'next/link'
import { ArrowLeft, Search, Plus, RefreshCw, Trash2, Save, X, CalendarCheck, History } from 'lucide-react'

type Editable = Partial<Member>

const STATUSES = ['active', 'expired', 'canceled'] as const

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}
function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
// Renewal extends from the later of today or the current (unexpired) renewal date.
function plusOneYear(current: string | null) {
  const today = ymd(new Date())
  const baseStr = current && current.slice(0, 10) > today ? current.slice(0, 10) : today
  const d = new Date(baseStr + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return ymd(d)
}

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<'name' | 'email' | 'renewal_date'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Editable>({})
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const user = await supabase.auth.getUser()
      if (!user.data.user) {
        window.location.href = '/login'
        return
      }
      await load()
    })()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true })
    if (error) setMsg({ text: `Error loading members: ${error.message}`, ok: false })
    setMembers((data as Member[]) || [])
    setLoading(false)
  }

  async function apiWrite(method: 'PATCH' | 'POST' | 'DELETE', payload: any) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || ''
    const url = method === 'DELETE' ? `/api/members?id=${encodeURIComponent(payload.id)}` : '/api/members'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: method === 'DELETE' ? undefined : JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `${method} failed`)
    return json
  }

  // One-time: reconstruct per-member email history from already-sent broadcasts.
  async function backfillEmailHistory() {
    if (!confirm('Rebuild email history from past sends? This reconstructs which members received earlier broadcasts (approximate) and is safe to run more than once.')) return
    setBusy(true); setMsg(null)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/backfill-email-log', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Backfill failed')
      setMsg({ text: `Email history rebuilt — ${json.inserted} entries added across ${json.processed} past emails.`, ok: true })
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Backfill failed', ok: false }) } finally { setBusy(false) }
  }

  const types = useMemo(
    () => Array.from(new Set(members.map((m) => m.membership_type).filter(Boolean))) as string[],
    [members],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = members.filter((m) => {
      if (statusFilter !== 'all' && (m.status || '') !== statusFilter) return false
      if (typeFilter !== 'all' && (m.membership_type || '') !== typeFilter) return false
      if (!q) return true
      return (
        (m.full_name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q)
      )
    })
    const keyOf = (m: Member) => {
      if (sortKey === 'email') return (m.email || '').toLowerCase()
      if (sortKey === 'renewal_date') return (m.renewal_date || '')
      // name → last name, then first name
      return `${(m.last_name || m.full_name || '').toLowerCase()} ${(m.first_name || '').toLowerCase()}`
    }
    list.sort((a, b) => {
      const av = keyOf(a), bv = keyOf(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [members, query, statusFilter, typeFilter, sortKey, sortDir])

  function sortBy(key: 'name' | 'email' | 'renewal_date') {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  const counts = useMemo(() => {
    const c = { active: 0, expired: 0, canceled: 0, other: 0 }
    for (const m of members) {
      if (m.status === 'active') c.active++
      else if (m.status === 'expired') c.expired++
      else if (m.status === 'canceled') c.canceled++
      else c.other++
    }
    return c
  }, [members])

  function startEdit(m: Member) {
    setAdding(false)
    setEditId(m.id)
    setForm({
      full_name: m.full_name,
      email: m.email,
      membership_type: m.membership_type,
      status: m.status,
      renewal_date: m.renewal_date ? m.renewal_date.slice(0, 10) : null,
      expired_date: m.expired_date ? m.expired_date.slice(0, 10) : null,
      autorenew: m.autorenew,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startAdd() {
    setEditId(null)
    setAdding(true)
    setForm({ full_name: '', email: '', membership_type: 'Membership', status: 'active', renewal_date: plusOneYear(null), expired_date: null, autorenew: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelForm() {
    setEditId(null)
    setAdding(false)
    setForm({})
  }

  async function saveForm() {
    setBusy(true)
    setMsg(null)
    try {
      if (adding) {
        const { member } = await apiWrite('POST', { member: form })
        setMembers((prev) => [...prev, member].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
        setMsg({ text: `Added ${member.full_name}.`, ok: true })
      } else if (editId) {
        const { member } = await apiWrite('PATCH', { id: editId, updates: form })
        setMembers((prev) => prev.map((m) => (m.id === editId ? member : m)))
        setMsg({ text: `Saved ${member.full_name}.`, ok: true })
      }
      cancelForm()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Save failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function markRenewed(m: Member) {
    setBusy(true)
    setMsg(null)
    try {
      const updates = { renewal_date: plusOneYear(m.renewal_date), status: 'active', expired_date: null }
      const { member } = await apiWrite('PATCH', { id: m.id, updates, logRenewal: true })
      setMembers((prev) => prev.map((x) => (x.id === m.id ? member : x)))
      setMsg({ text: `${member.full_name} renewed through ${fmtDate(member.renewal_date)}.`, ok: true })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Renew failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`Delete ${m.full_name}? This cannot be undone.`)) return
    setBusy(true)
    setMsg(null)
    try {
      await apiWrite('DELETE', { id: m.id })
      setMembers((prev) => prev.filter((x) => x.id !== m.id))
      setMsg({ text: `Deleted ${m.full_name}.`, ok: true })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Delete failed', ok: false })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div style={s.loading}>Loading members…</div>

  return (
    <div style={s.container}>
      <header style={s.header}>
        <Link href="/admin" style={s.backLink}>
          <ArrowLeft size={20} />
          Back to Admin
        </Link>
        <h1 style={{ fontSize: 22 }}>Members</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={backfillEmailHistory} disabled={busy} style={s.ghostHeaderBtn} title="One-time: rebuild per-member email history from past sends">
            <History size={15} /> Rebuild email history
          </button>
          <button onClick={startAdd} style={s.addBtn}>
            <Plus size={16} /> Add Member
          </button>
        </div>
      </header>

      <main style={s.main}>
        {msg && (
          <div style={{ ...s.message, background: msg.ok ? '#d1fae5' : '#fee2e2', color: msg.ok ? '#065f46' : '#7f1d1d' }}>
            {msg.text}
          </div>
        )}

        {(adding || editId) && (
          <div style={s.card}>
            <div style={s.editHead}>
              <h2 style={{ fontSize: 18 }}>{adding ? 'Add Member' : 'Edit Member'}</h2>
              <button onClick={cancelForm} style={s.iconBtn} title="Cancel"><X size={18} /></button>
            </div>
            <div style={s.formGrid}>
              <Field label="Full name">
                <input style={s.input} value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </Field>
              <Field label="Email">
                <input style={s.input} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Membership type">
                <input style={s.input} value={form.membership_type ?? ''} onChange={(e) => setForm({ ...form, membership_type: e.target.value })} />
              </Field>
              <Field label="Status">
                <select style={s.input} value={form.status ?? ''} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                  <option value="">—</option>
                  {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </Field>
              <Field label="Renewal date">
                <input type="date" style={s.input} value={(form.renewal_date as string) ?? ''} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
              </Field>
              <Field label="Expired date">
                <input type="date" style={s.input} value={(form.expired_date as string) ?? ''} onChange={(e) => setForm({ ...form, expired_date: e.target.value })} />
              </Field>
              <Field label="Auto-renew">
                <label style={s.checkboxRow}>
                  <input type="checkbox" checked={!!form.autorenew} onChange={(e) => setForm({ ...form, autorenew: e.target.checked })} />
                  <span style={{ fontSize: 14 }}>On autopay</span>
                </label>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={saveForm} disabled={busy} style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}>
                <Save size={16} /> {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelForm} style={s.secondaryBtn}>Cancel</button>
            </div>
          </div>
        )}

        <div style={s.toolbar}>
          <div style={s.searchWrap}>
            <Search size={16} style={{ color: '#9ca3af' }} />
            <input
              style={s.searchInput}
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select style={s.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={load} style={s.secondaryBtn} title="Reload"><RefreshCw size={16} /></button>
        </div>

        <p style={s.summary}>
          {members.length} members · <b style={{ color: '#059669' }}>{counts.active} active</b> · <b style={{ color: '#d97706' }}>{counts.expired} expired</b> · {counts.canceled} canceled{counts.other ? ` · ${counts.other} no status` : ''} — showing {filtered.length}
        </p>

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => sortBy('name')}>Name (last){arrow('name')}</th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => sortBy('email')}>Email{arrow('email')}</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => sortBy('renewal_date')}>Renewal{arrow('renewal_date')}</th>
                <th style={s.th}>Auto</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={s.td}><Link href={`/admin/members/${m.id}`} style={s.nameLink} title="View history & payments">{m.full_name}</Link></td>
                  <td style={{ ...s.td, color: '#6b7280' }}>{m.email || '—'}</td>
                  <td style={{ ...s.td, color: '#6b7280' }}>{m.membership_type || '—'}</td>
                  <td style={s.td}><StatusBadge status={m.status} /></td>
                  <td style={s.td}>{fmtDate(m.renewal_date)}</td>
                  <td style={s.td}>{m.autorenew ? '✓' : ''}</td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => markRenewed(m)} disabled={busy} style={s.renewBtn} title="Mark paid in person — renew 1 year">
                      <CalendarCheck size={14} /> Renew
                    </button>
                    <Link href={`/admin/members/${m.id}`} style={s.linkBtn} title="Payments & email history">History</Link>
                    <button onClick={() => startEdit(m)} style={s.linkBtn}>Edit</button>
                    <button onClick={() => removeMember(m)} style={s.trashBtn} title="Delete"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td style={{ ...s.td, color: '#9ca3af' }} colSpan={7}>No members match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#d1fae5', fg: '#065f46' },
    expired: { bg: '#fee2e2', fg: '#7f1d1d' },
    canceled: { bg: '#f3f4f6', fg: '#4b5563' },
  }
  const c = (status && map[status]) || { bg: '#f3f4f6', fg: '#9ca3af' }
  return <span style={{ ...s.badge, background: c.bg, color: c.fg }}>{status || 'none'}</span>
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f9fafb' },
  header: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backLink: { display: 'flex', alignItems: 'center', gap: 8, color: 'white', textDecoration: 'none', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 },
  ghostHeaderBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,255,255,0.12)', color: 'white', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  main: { maxWidth: 1100, margin: '32px auto', padding: '0 20px' },
  card: { background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: 20 },
  editHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' },
  input: { width: '100%', padding: '9px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'inherit' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0' },
  toolbar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: '1px solid #d1d5db', borderRadius: 8, padding: '0 12px', flex: 1, minWidth: 220 },
  searchInput: { border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, width: '100%', fontFamily: 'inherit' },
  select: { padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: 'white' },
  summary: { color: '#6b7280', fontSize: 13, margin: '4px 2px 14px' },
  tableWrap: { background: 'white', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '12px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', color: '#1f2937', verticalAlign: 'middle' },
  badge: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 },
  renewBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginRight: 8 },
  linkBtn: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginRight: 8, textDecoration: 'none' },
  nameLink: { color: '#1e3f5f', fontWeight: 600, textDecoration: 'none' },
  trashBtn: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', verticalAlign: 'middle' },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' },
  message: { padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontSize: 18, color: '#6b7280' },
}
