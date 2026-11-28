'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MEMBERSHIP_BENEFITS as BENEFITS } from '@/lib/benefits'

const BRAND = '#2a5680'
const INK = '#1f2937'
const MUTED = '#5b6472'
const TINT = '#eef3f8'

const TIERS = [
  { label: 'Regular', price: '$50', note: 'per person / year' },
  { label: 'Student', price: '$25', note: 'per year' },
  { label: 'Founders', price: 'Free', note: 'complimentary' },
]

export default function MembershipPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [company, setCompany] = useState('') // spam trap (hidden)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !email.includes('@')) { setError('Please enter your name and a valid email.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/membership-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, company }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Something went wrong')
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #e6eaef' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Link href="/"><img src="/footcandle-logo.png" alt="Footcandle Film Society" style={{ height: 66, width: 'auto', display: 'block' }} /></Link>
          <Link href="/login" style={{ color: BRAND, fontWeight: 700, textDecoration: 'none', border: `1.5px solid ${BRAND}`, padding: '9px 14px', borderRadius: 8, fontSize: 14 }}>Member Login</Link>
        </div>
      </nav>

      <section style={{ background: `linear-gradient(180deg, ${TINT}, #fff)` }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '52px 24px 40px' }}>
          <h1 style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.08 }}>Become a member</h1>
          <p style={{ marginTop: 16, fontSize: 19, color: '#374151', lineHeight: 1.65, maxWidth: 640 }}>
            Footcandle Film Society is a member-supported nonprofit bringing the best of independent, foreign, and
            award-nominated film to Catawba County and Western North Carolina — with real conversation after every screening.
            Your membership makes it all possible.
          </p>
        </div>
      </section>

      <section>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 24px 8px' }}>
          <h2 style={h2}>Membership</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
            {TIERS.map((t) => (
              <div key={t.label} style={{ flex: '1 1 180px', background: '#fff', border: '1.5px solid #dbe3ec', borderRadius: 12, padding: '20px 22px' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{t.label}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: BRAND, marginTop: 6 }}>{t.price}</div>
                <div style={{ fontSize: 13, color: MUTED }}>{t.note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 8px' }}>
          <h2 style={h2}>What members enjoy</h2>
          <ul style={{ marginTop: 16, listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {BENEFITS.map((b, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', color: '#374151', lineHeight: 1.5 }}>
                <span style={{ color: BRAND, fontWeight: 800, flex: 'none' }}>✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 72px' }}>
          <div style={{ background: TINT, border: '1px solid #dbe3ec', borderRadius: 16, padding: 'clamp(24px,4vw,36px)' }}>
            {sent ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 44 }}>🎬</div>
                <h2 style={{ ...h2, marginTop: 8 }}>Thank you — we'll be in touch!</h2>
                <p style={{ marginTop: 12, color: '#374151', lineHeight: 1.6, maxWidth: 480, margin: '12px auto 0' }}>
                  We've received your interest in joining Footcandle Film Society. Someone from our team will reach out to
                  <b> {email}</b> shortly with instructions to complete your membership.
                </p>
                <Link href="/" style={{ ...cta, display: 'inline-block', marginTop: 24 }}>Back to home</Link>
              </div>
            ) : (
              <>
                <h2 style={h2}>Interested in joining?</h2>
                <p style={{ marginTop: 8, color: MUTED, lineHeight: 1.55 }}>Tell us who you are and we'll follow up shortly with everything you need to become a member.</p>
                <form onSubmit={submit} style={{ marginTop: 20 }}>
                  {/* Spam trap: hidden from people, often filled in by bots. */}
                  <div aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
                    <label>Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
                  </div>
                  <label style={label}>Your name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" required style={input} />
                  <label style={label}>Email address</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required style={input} />
                  <label style={label}>Anything you'd like us to know? (optional)</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Questions, how you heard about us, etc." style={{ ...input, resize: 'vertical' }} />
                  {error && <div style={{ marginTop: 4, marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: '#fee2e2', color: '#b1281f', fontSize: 14 }}>{error}</div>}
                  <button type="submit" disabled={loading} style={{ ...cta, width: '100%', opacity: loading ? 0.6 : 1, border: 'none', cursor: 'pointer' }}>
                    {loading ? 'Sending…' : 'Submit my interest'}
                  </button>
                </form>
                <p style={{ marginTop: 14, fontSize: 13, color: MUTED, textAlign: 'center' }}>Already a member? <Link href="/login" style={{ color: BRAND, fontWeight: 600 }}>Sign in to renew.</Link></p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

const h2: React.CSSProperties = { fontSize: 'clamp(22px,3.5vw,28px)', fontWeight: 800, letterSpacing: '-0.01em', color: INK }
const label: React.CSSProperties = { display: 'block', fontSize: 14, fontWeight: 600, margin: '14px 0 6px', color: INK }
const input: React.CSSProperties = { width: '100%', padding: '13px 14px', borderRadius: 8, border: '1.5px solid #cfd8e3', background: '#fff', color: INK, fontSize: 15, fontFamily: 'inherit' }
const cta: React.CSSProperties = { background: BRAND, color: '#fff', fontWeight: 800, fontSize: 16, padding: '14px 24px', borderRadius: 10, textDecoration: 'none' }
