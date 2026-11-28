'use client'

// New-member join + pay. Not linked in any navigation — we direct interested
// people here after they express interest. Public (no login). Collects name +
// email, tier, and billing, then Stripe Checkout via /api/checkout-new.
import { useEffect, useState } from 'react'
import Link from 'next/link'

const BRAND = '#2a5680'
const INK = '#1f2937'
const MUTED = '#5b6472'

type Tier = 'regular' | 'student'
type Mode = 'subscription' | 'payment'

const TIERS: { id: Tier; label: string; price: string; note: string }[] = [
  { id: 'regular', label: 'Regular', price: '$50', note: 'per person / year' },
  { id: 'student', label: 'Student', price: '$25', note: 'per year' },
]

const PRICE: Record<Tier, number> = { regular: 50, student: 25 }

export default function NewMemberPage() {
  const [tier, setTier] = useState<Tier>('regular')
  const [mode, setMode] = useState<Mode>('subscription')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [addSecond, setAddSecond] = useState(false)
  const [secondName, setSecondName] = useState('')
  const [secondEmail, setSecondEmail] = useState('')
  const [secondTier, setSecondTier] = useState<Tier>('regular')
  const [canceled, setCanceled] = useState(false)
  const [invite, setInvite] = useState('') // signed token from an invitation email
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const total = PRICE[tier] + (addSecond ? PRICE[secondTier] : 0)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setCanceled(q.get('canceled') === '1')
    // Arrived from an invitation email: pre-fill their name + email.
    const t = q.get('invite')
    if (!t) return
    setInvite(t)
    fetch(`/api/invite-context?t=${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return
        if (j.name) setName((v) => v || j.name)
        if (j.email) setEmail((v) => v || j.email)
      })
      .catch(() => {})
  }, [])

  async function checkout() {
    setError('')
    if (!name.trim()) { setError('Please enter your name.'); return }
    if (!email.includes('@')) { setError('Please enter a valid email.'); return }
    if (addSecond && (!secondName.trim() || !secondEmail.includes('@'))) { setError('Please enter the second person’s name and a valid email — or uncheck the second membership.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/checkout-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, tier, mode, invite: invite || undefined, second: addSecond ? { name: secondName, email: secondEmail, tier: secondTier } : undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not start checkout')
      window.location.href = json.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#f7f9fc', color: INK, minHeight: '100vh' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '28px 24px 64px' }}>
        <Link href="/"><img src="/footcandle-logo.png" alt="Footcandle Film Society" style={{ height: 56, width: 'auto', display: 'block' }} /></Link>

        <h1 style={{ fontSize: 32, fontWeight: 800, marginTop: 32, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Welcome to the Footcandle Film Society</h1>
        <p style={{ marginTop: 12, color: MUTED, lineHeight: 1.6 }}>
          Your membership is good for 12 months, and you'll start receiving all of our email invitations immediately after joining.
        </p>

        {canceled && <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 8, background: '#fff4e5', color: '#8a5a00', fontSize: 14 }}>Checkout canceled — no charge was made. You can try again below.</div>}

        <h2 style={label}>Membership</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {TIERS.map((t) => (
            <button key={t.id} onClick={() => setTier(t.id)} style={{ ...tierCard, ...(tier === t.id ? active : {}) }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{t.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: BRAND, marginTop: 4 }}>{t.price}</div>
              <div style={{ fontSize: 12, color: MUTED }}>{t.note}</div>
            </button>
          ))}
        </div>

        <h2 style={label}>Billing</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setMode('subscription')} style={{ ...modeCard, ...(mode === 'subscription' ? active : {}) }}>
            <div style={{ fontWeight: 700 }}>Auto-renew yearly</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>Renews automatically each year. Cancel anytime.</div>
          </button>
          <button onClick={() => setMode('payment')} style={{ ...modeCard, ...(mode === 'payment' ? active : {}) }}>
            <div style={{ fontWeight: 700 }}>One-time (one year)</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>Pay for a single year, no auto-charge.</div>
          </button>
        </div>

        <h2 style={label}>Your name</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" style={input} />

        <h2 style={label}>Email address</h2>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={input} />

        {/* Optional second membership (e.g. a spouse), paid together */}
        <div style={{ marginTop: 24, padding: 16, background: '#eef3f8', border: '1px solid #dbe3ec', borderRadius: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, color: INK }}>
            <input type="checkbox" checked={addSecond} onChange={(e) => setAddSecond(e.target.checked)} />
            Add a second membership (e.g., for a spouse), paid together
          </label>
          {addSecond && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={s2}>Second person’s name</label><input value={secondName} onChange={(e) => setSecondName(e.target.value)} placeholder="First and last name" style={input} /></div>
              <div><label style={s2}>Second person’s email</label><input type="email" value={secondEmail} onChange={(e) => setSecondEmail(e.target.value)} placeholder="their@email.com" style={input} /></div>
              <div>
                <label style={s2}>Membership type</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {TIERS.map((t) => (
                    <button key={t.id} onClick={() => setSecondTier(t.id)} style={{ ...tierCard, flex: '1 1 130px', ...(secondTier === t.id ? active : {}) }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{t.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: BRAND }}>{t.price}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, background: '#fee2e2', color: '#b1281f', fontSize: 14 }}>{error}</div>}

        <button onClick={checkout} disabled={loading} style={{ ...cta, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Redirecting to secure checkout…' : `Continue to secure checkout — $${total}${mode === 'subscription' ? '/yr' : ''}`}
        </button>
        <p style={{ fontSize: 12, color: MUTED, marginTop: 14, textAlign: 'center' }}>Payments are processed securely by Stripe. Footcandle never sees your card details.</p>
      </div>
    </div>
  )
}

const label: React.CSSProperties = { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: MUTED, margin: '30px 0 12px' }
const s2: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }
const tierCard: React.CSSProperties = { flex: '1 1 160px', textAlign: 'left', background: '#fff', border: '1.5px solid #dbe3ec', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', color: INK }
const modeCard: React.CSSProperties = { flex: '1 1 200px', textAlign: 'left', background: '#fff', border: '1.5px solid #dbe3ec', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', color: INK }
const active: React.CSSProperties = { borderColor: BRAND, background: '#eef3f8', boxShadow: `0 0 0 1px ${BRAND}` }
const input: React.CSSProperties = { width: '100%', padding: '13px 14px', borderRadius: 8, border: '1.5px solid #cfd8e3', background: '#fff', color: INK, fontSize: 15, fontFamily: 'inherit' }
const cta: React.CSSProperties = { width: '100%', marginTop: 24, padding: '15px', background: BRAND, color: '#fff', fontWeight: 800, fontSize: 16, border: 'none', borderRadius: 10, cursor: 'pointer' }
