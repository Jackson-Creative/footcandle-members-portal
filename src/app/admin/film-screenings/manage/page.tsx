'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Plus, Save, Trash2, X, Eye, EyeOff, Calendar, Upload } from 'lucide-react'

type DateRow = { id: string; screening_date: string; screening_time: string | null; venue: string | null; location_city: string | null; address: string | null; closed_captioned?: boolean | null }
type Film = {
  id: string; title: string; description: string | null; about_film: string | null; poster_url: string | null
  rating: string | null; running_time: string | null; trailer_url: string | null; published: boolean
  screening_dates: DateRow[] | null
}

function fmt(dateStr: string, timeStr?: string | null) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!timeStr) return day
  const [h, m] = timeStr.split(':')
  return `${day} · ${((+h + 11) % 12) + 1}:${m} ${+h >= 12 ? 'PM' : 'AM'}`
}
const emptyDate = { screening_date: '', screening_time: '', venue: '', location_city: '', address: '', closed_captioned: false }

export default function ManageFilmScreenings() {
  const [films, setFilms] = useState<Film[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Film>>({})
  const [newDate, setNewDate] = useState<any>(emptyDate)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    ;(async () => {
      const u = await supabase.auth.getUser()
      if (!u.data.user) { window.location.href = '/login'; return }
      await load()
    })()
  }, [])

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token || '' }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('film_screenings')
      .select('id,title,description,about_film,poster_url,rating,running_time,trailer_url,published,screening_dates(*)')
      .order('created_at', { ascending: false })
    if (error) setMsg({ text: error.message, ok: false })
    setFilms((data as Film[]) || [])
    setLoading(false)
  }

  async function api(method: 'PATCH' | 'POST' | 'DELETE', payload: any, qs = '') {
    const res = await fetch('/api/film-screenings' + qs, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: method === 'DELETE' ? undefined : JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `${method} failed`)
    return json
  }

  function startEdit(f: Film) {
    setEditId(f.id)
    setForm({ title: f.title, description: f.description, about_film: f.about_film, poster_url: f.poster_url, rating: f.rating, running_time: f.running_time, trailer_url: f.trailer_url, published: f.published })
    setNewDate(emptyDate)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function cancel() { setEditId(null); setForm({}); setNewDate(emptyDate) }

  // Upload a replacement poster to the film-posters bucket and point the form at
  // its public URL. Still requires "Save changes" to persist to the film record.
  async function uploadPoster(file: File) {
    setUploading(true); setMsg(null)
    try {
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('film-posters').upload(fileName, file)
      if (upErr) throw new Error(upErr.message)
      const { data: { publicUrl } } = supabase.storage.from('film-posters').getPublicUrl(fileName)
      setForm((prev) => ({ ...prev, poster_url: publicUrl }))
      setMsg({ text: 'Poster uploaded — click “Save changes” to apply it.', ok: true })
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Upload failed', ok: false }) } finally { setUploading(false) }
  }

  async function saveFilm() {
    if (!editId) return
    setBusy(true); setMsg(null)
    try {
      await api('PATCH', { id: editId, updates: form })
      await load()
      setMsg({ text: 'Saved.', ok: true })
      cancel()
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  async function togglePublish(f: Film) {
    setBusy(true); setMsg(null)
    try {
      await api('PATCH', { id: f.id, updates: { published: !f.published } })
      setFilms((p) => p.map((x) => (x.id === f.id ? { ...x, published: !x.published } : x)))
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  async function deleteFilm(f: Film) {
    if (!confirm(`Delete "${f.title}" and all its screening dates? This cannot be undone.`)) return
    setBusy(true); setMsg(null)
    try {
      await api('DELETE', null, `?id=${encodeURIComponent(f.id)}`)
      setFilms((p) => p.filter((x) => x.id !== f.id))
      if (editId === f.id) cancel()
      setMsg({ text: `Deleted "${f.title}".`, ok: true })
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  async function toggleCC(d: DateRow) {
    setBusy(true); setMsg(null)
    try {
      await api('PATCH', { dateId: d.id, updates: { closed_captioned: !d.closed_captioned } })
      await load()
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  async function deleteDate(dateId: string) {
    setBusy(true); setMsg(null)
    try {
      await api('DELETE', null, `?dateId=${encodeURIComponent(dateId)}`)
      await load()
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  async function addDate() {
    if (!editId || !newDate.screening_date) { setMsg({ text: 'Enter at least a date.', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      await api('POST', { film_screening_id: editId, date: newDate })
      setNewDate(emptyDate)
      await load()
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) } finally { setBusy(false) }
  }

  const editing = films.find((f) => f.id === editId)

  if (loading) return <div style={s.loading}>Loading screenings…</div>

  return (
    <div style={s.container}>
      <header style={s.header}>
        <Link href="/admin" style={s.backLink}><ArrowLeft size={20} /> Back to Admin</Link>
        <h1 style={{ fontSize: 22 }}>Film Screenings</h1>
        <Link href="/admin/film-screenings" style={s.addBtn}><Plus size={16} /> New Screening</Link>
      </header>

      <main style={s.main}>
        {msg && <div style={{ ...s.message, background: msg.ok ? '#d1fae5' : '#fee2e2', color: msg.ok ? '#065f46' : '#7f1d1d' }}>{msg.text}</div>}

        {editing && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18 }}>Edit “{editing.title}”</h2>
              <button onClick={cancel} style={s.iconBtn}><X size={18} /></button>
            </div>
            <div style={s.formGrid}>
              <F label="Title" span2><input style={s.input} value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></F>
              <F label="Rating"><input style={s.input} value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value })} /></F>
              <F label="Running time"><input style={s.input} value={form.running_time ?? ''} onChange={(e) => setForm({ ...form, running_time: e.target.value })} /></F>
              <F label="Poster image" span2>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {form.poster_url ? <img src={form.poster_url} alt="" style={{ width: 60, height: 'auto', borderRadius: 5, border: '1px solid #e5e7eb', flexShrink: 0 }} /> : null}
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <input style={s.input} placeholder="Paste an image URL, or upload a file below" value={form.poster_url ?? ''} onChange={(e) => setForm({ ...form, poster_url: e.target.value })} />
                    <label style={{ ...s.secondaryBtn, display: 'inline-flex', marginTop: 8, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                      <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload new poster'}
                      <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPoster(f); e.currentTarget.value = '' }} />
                    </label>
                  </div>
                </div>
              </F>
              <F label="Trailer URL (YouTube/Vimeo)" span2><input style={s.input} value={form.trailer_url ?? ''} onChange={(e) => setForm({ ...form, trailer_url: e.target.value })} /></F>
              <F label="Short description" span2><textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></F>
              <F label="About the film" span2><textarea rows={4} style={{ ...s.input, resize: 'vertical' }} value={form.about_film ?? ''} onChange={(e) => setForm({ ...form, about_film: e.target.value })} /></F>
              <F label="Published"><label style={s.checkboxRow}><input type="checkbox" checked={!!form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /><span style={{ fontSize: 14 }}>Show on the public site</span></label></F>
            </div>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '22px 0 10px' }}>Screening dates</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(editing.screening_dates || []).slice().sort((a, b) => a.screening_date.localeCompare(b.screening_date)).map((d) => (
                <div key={d.id} style={s.dateRow}>
                  <span style={{ fontSize: 14 }}>{fmt(d.screening_date, d.screening_time)} — {[d.venue, d.location_city].filter(Boolean).join(', ')}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => toggleCC(d)}
                      disabled={busy}
                      style={d.closed_captioned ? s.ccToggleOn : s.ccToggleOff}
                      title={d.closed_captioned ? 'Closed Captioned — click to turn off' : 'Mark this showtime Closed Captioned'}
                    >
                      {d.closed_captioned ? 'CC · Closed Captioned' : '+ Closed Captioned'}
                    </button>
                    <button onClick={() => deleteDate(d.id)} disabled={busy} style={s.trashBtn} title="Remove this date"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {(!editing.screening_dates || editing.screening_dates.length === 0) && <p style={{ color: '#9ca3af', fontSize: 14 }}>No dates yet.</p>}
            </div>
            <div style={{ ...s.dateRow, marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <input type="date" style={{ ...s.input, width: 'auto' }} value={newDate.screening_date} onChange={(e) => setNewDate({ ...newDate, screening_date: e.target.value })} />
              <input type="time" style={{ ...s.input, width: 'auto' }} value={newDate.screening_time} onChange={(e) => setNewDate({ ...newDate, screening_time: e.target.value })} />
              <input placeholder="Venue" style={{ ...s.input, width: 130 }} value={newDate.venue} onChange={(e) => setNewDate({ ...newDate, venue: e.target.value })} />
              <input placeholder="City" style={{ ...s.input, width: 110 }} value={newDate.location_city} onChange={(e) => setNewDate({ ...newDate, location_city: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!!newDate.closed_captioned} onChange={(e) => setNewDate({ ...newDate, closed_captioned: e.target.checked })} /> Closed Captioned
              </label>
              <button onClick={addDate} disabled={busy} style={s.secondaryBtn}><Calendar size={14} /> Add date</button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={saveFilm} disabled={busy} style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}><Save size={16} /> {busy ? 'Saving…' : 'Save changes'}</button>
              <button onClick={cancel} style={s.secondaryBtn}>Cancel</button>
            </div>
          </div>
        )}

        <p style={{ color: '#6b7280', fontSize: 14, margin: '4px 0 14px' }}>{films.length} screening{films.length === 1 ? '' : 's'}. Edit details, add/remove dates, hide from the site, or delete.</p>
        {films.length === 0 ? (
          <div style={s.empty}>No film screenings yet. <Link href="/admin/film-screenings" style={{ color: '#2a5680', fontWeight: 600 }}>Create one →</Link></div>
        ) : films.map((f) => (
          <div key={f.id} style={s.filmRow}>
            {f.poster_url ? <img src={f.poster_url} alt={f.title} style={{ width: 54, height: 'auto', borderRadius: 5, flexShrink: 0 }} /> : <div style={{ width: 54, height: 78, background: '#e5e7eb', borderRadius: 5, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: '#1f2937' }}>{f.title}</span>
                {!f.published && <span style={s.hiddenPill}>hidden</span>}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                {(f.screening_dates || []).length
                  ? (f.screening_dates || []).slice().sort((a, b) => a.screening_date.localeCompare(b.screening_date)).map((d) => fmt(d.screening_date, d.screening_time)).join('  ·  ')
                  : 'No dates set'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <button onClick={() => togglePublish(f)} disabled={busy} style={s.iconBtn} title={f.published ? 'Hide from public site' : 'Show on public site'}>{f.published ? <Eye size={16} /> : <EyeOff size={16} />}</button>
              <button onClick={() => startEdit(f)} style={s.linkBtn}>Edit</button>
              <button onClick={() => deleteFilm(f)} disabled={busy} style={s.trashBtn} title="Delete screening"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}

function F({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return <div style={span2 ? { gridColumn: '1 / -1' } : undefined}><label style={s.label}>{label}</label>{children}</div>
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f9fafb' },
  header: { background: 'linear-gradient(135deg, #2a5680 0%, #1e3f5f 100%)', color: 'white', padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backLink: { display: 'flex', alignItems: 'center', gap: 8, color: 'white', textDecoration: 'none' },
  addBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.2)', color: 'white', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: 14 },
  main: { maxWidth: 860, margin: '32px auto', padding: '0 20px' },
  card: { background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' },
  input: { width: '100%', padding: '9px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'inherit' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0' },
  dateRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#f9fafb', border: '1px solid #eef1f5', borderRadius: 8, padding: '8px 12px' },
  filmRow: { display: 'flex', alignItems: 'center', gap: 14, background: 'white', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '12px 14px', marginBottom: 10 },
  hiddenPill: { fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '2px 8px' },
  ccToggleOn: { fontSize: 11, fontWeight: 700, color: '#8a5a00', background: '#fdf0d5', border: '1px solid #e6b34d', borderRadius: 6, padding: '4px 9px', whiteSpace: 'nowrap', cursor: 'pointer' },
  ccToggleOff: { fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 6, padding: '4px 9px', whiteSpace: 'nowrap', cursor: 'pointer' },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 },
  linkBtn: { background: 'none', border: 'none', color: '#2a5680', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  trashBtn: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 },
  message: { padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { border: '1px dashed #d1d5db', borderRadius: 10, padding: 28, color: '#9ca3af', textAlign: 'center', fontSize: 14 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontSize: 18, color: '#6b7280' },
}
