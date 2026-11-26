// Public homepage for footcandle.org — light, editorial, keyed to the brand
// blue (#2a5680) and the real Footcandle logo. Server component: reads
// published screenings + community events (graceful empty states).
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const revalidate = 60

const PODCAST_APPLE = 'https://podcasts.apple.com/us/podcast/footcandle-films/id1452574037'
const PODCAST_EMBED = 'https://embed.podcasts.apple.com/us/podcast/footcandle-films/id1452574037'
const FESTIVAL_URL = 'https://www.footcandlefilmfestival.com'
const GRANT_URL = '/filmmaker-grant-program'
const FACEBOOK = 'https://www.facebook.com/footcandle'
const YOUTUBE = 'https://www.youtube.com/channel/UCX4K0xedXNND7wJue-Xwu-g'
const EMAIL = 'info@footcandle.org'

const BRAND = '#2a5680'
const BRAND_DARK = '#1e3f5f'
const TINT = '#eef3f8'
const INK = '#1f2937'
const MUTED = '#5b6472'

type DateRow = { screening_date: string; screening_time: string | null; venue: string | null; location_city: string | null; address: string | null; closed_captioned?: boolean | null }
type Film = { id: string; title: string; description: string | null; poster_url: string | null; rating: string | null; running_time: string | null; screening_dates: DateRow[] | null }
type Community = { id: string; title: string; description: string | null; poster_url: string | null; event_date: string; event_time: string | null; venue: string | null; location_city: string | null; host_org: string | null; link_url: string | null }

function today() { return new Date().toISOString().slice(0, 10) }
function fmtLong(dateStr: string, timeStr?: string | null) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  if (!timeStr) return day
  const [h, m] = timeStr.split(':')
  return `${day} · ${((+h + 11) % 12) + 1}:${m} ${+h >= 12 ? 'PM' : 'AM'}`
}
function fmtShort(dateStr: string, timeStr?: string | null) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (!timeStr) return day
  const [h, m] = timeStr.split(':')
  return `${day} · ${((+h + 11) % 12) + 1}:${m} ${+h >= 12 ? 'PM' : 'AM'}`
}
// "Dec 8–10", "Dec 30 – Jan 2", or a single "Dec 3" for a one-night screening.
function fmtRange(dates: DateRow[]) {
  const md = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const first = dates[0].screening_date, last = dates[dates.length - 1].screening_date
  if (first === last) return new Date(first + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  if (first.slice(0, 7) === last.slice(0, 7)) return `${md(first)}–${+last.slice(8, 10)}`
  return `${md(first)} – ${md(last)}`
}
function dateKey(d: DateRow) { return d.screening_date + (d.screening_time || '') }

type Upcoming = { film: Film; dates: DateRow[] }

// Every published film with at least one upcoming date, soonest first, each
// with ALL of its upcoming dates/locations (sorted). The first one is the
// featured "next screening"; the rest fill the "more upcoming" row.
async function getUpcomingScreenings(): Promise<Upcoming[]> {
  const { data, error } = await supabase
    .from('film_screenings')
    .select('id,title,description,poster_url,rating,running_time,screening_dates(*)')
    .eq('published', true)
  if (error || !data) return []
  const out: Upcoming[] = []
  for (const f of data as Film[]) {
    const dates = (f.screening_dates || []).filter((d) => d.screening_date >= today()).sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
    if (dates.length) out.push({ film: f, dates })
  }
  return out.sort((a, b) => dateKey(a.dates[0]).localeCompare(dateKey(b.dates[0])))
}
async function getCommunityEvents(): Promise<Community[]> {
  const { data, error } = await supabase.from('community_events').select('*').eq('published', true).gte('event_date', today()).order('event_date').limit(6)
  if (error || !data) return []
  return data as Community[]
}

// Small "Closed Captioned" indicator shown under a screening that has captions.
function CCBadge({ compact }: { compact?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: compact ? 0 : 8, fontSize: 12, fontWeight: 700, color: '#8a5a00', background: '#fdf0d5', border: '1px solid #e6b34d', borderRadius: 6, padding: '3px 9px', letterSpacing: 0.2 }}>
      <span style={{ fontWeight: 800, background: '#8a5a00', color: '#fdf0d5', borderRadius: 3, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}>CC</span>
      Closed Captioned
    </span>
  )
}

export default async function Home() {
  const [upcoming, community] = await Promise.all([getUpcomingScreenings(), getCommunityEvents()])
  const featured = upcoming[0] || null
  const more = upcoming.slice(1, 7)

  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #e6eaef' }}>
        <div style={{ ...wrap, paddingTop: 18, paddingBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <Link href="/"><img src="/footcandle-logo.png" alt="Footcandle Film Society" style={{ height: 66, width: 'auto', display: 'block' }} /></Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="#screenings" style={navLink} className="nav-hide">Screenings</a>
            <a href={PODCAST_APPLE} target="_blank" rel="noopener noreferrer" style={navLink} className="nav-hide">Podcast</a>
            <a href={FESTIVAL_URL} target="_blank" rel="noopener noreferrer" style={navLink} className="nav-hide">Festival</a>
            <Link href="/login" style={btnOutline}>Member Login</Link>
            <Link href="/membership" style={btnPrimary}>Become a Member</Link>
          </div>
        </div>
      </nav>

      {/* Hero — compact "next screening" (soonest film, ALL its dates), then a
          row of the Film Society's later screenings */}
      <section style={{ background: `linear-gradient(180deg, ${TINT}, #fff)` }}>
        <div style={{ ...wrap, paddingTop: 40, paddingBottom: 44 }}>
          <p style={kicker}>Next Film Society Screening</p>
          {featured ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 24, alignItems: 'start' }} className="featured-grid">
              {featured.film.poster_url && (
                <Link href={`/film/${featured.film.id}`} style={{ justifySelf: 'center', display: 'block' }}>
                  <img src={featured.film.poster_url} alt={featured.film.title} className="featured-poster" style={{ width: '100%', maxWidth: 150, borderRadius: 10, display: 'block', boxShadow: '0 12px 32px rgba(30,63,95,0.22)' }} />
                </Link>
              )}
              <div>
                <h1 style={h1}>{featured.film.title}</h1>
                {(featured.film.rating || featured.film.running_time) && (
                  <p style={{ marginTop: 6, color: MUTED, fontSize: 14 }}>{[featured.film.rating, featured.film.running_time].filter(Boolean).join(' · ')}</p>
                )}
                {featured.film.description && <p style={{ marginTop: 10, color: '#374151', maxWidth: 620, lineHeight: 1.6, ...clamp3 }}>{featured.film.description}</p>}

                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 620 }}>
                  {featured.dates.map((d, i) => (
                    <div key={i} style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 8, padding: '8px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, fontSize: 14 }}>
                      <span style={{ fontWeight: 700, color: BRAND }}>{fmtShort(d.screening_date, d.screening_time)}</span>
                      <span style={{ color: MUTED }}>{[d.venue, d.location_city].filter(Boolean).join(' · ')}</span>
                      {d.closed_captioned && <CCBadge compact />}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Link href={`/film/${featured.film.id}`} style={btnPrimary}>About this Screening</Link>
                  <Link href="/membership" style={btnOutline}>Become a member</Link>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h1 style={{ ...h1, maxWidth: 780 }}>You like movies. So do we.</h1>
              <p style={{ marginTop: 16, fontSize: 19, color: '#374151', maxWidth: 620, lineHeight: 1.65 }}>
                Footcandle Film Society brings documentaries, foreign narratives, and award-nominated films — with real
                conversation — to Catawba County and Western North Carolina. Our next screening will be announced soon.
              </p>
              <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Link href="/membership" style={btnPrimaryLg}>Become a member</Link>
                <a href={PODCAST_APPLE} target="_blank" rel="noopener noreferrer" style={btnOutlineLg}>Listen to the podcast</a>
              </div>
            </div>
          )}

          {more.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <p style={kicker}>More Upcoming Film Society Screenings</p>
              <div style={gridFilms}>
                {more.map(({ film, dates }) => {
                  const places = Array.from(new Set(dates.map((d) => [d.venue, d.location_city].filter(Boolean).join(', ')).filter(Boolean)))
                  return (
                    <Link key={film.id} href={`/film/${film.id}`} style={{ ...card, padding: 14, textDecoration: 'none', color: INK, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      {film.poster_url && <img src={film.poster_url} alt={film.title} style={{ width: 84, height: 'auto', borderRadius: 6, flexShrink: 0, display: 'block' }} />}
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>{film.title}</h3>
                        <p style={{ marginTop: 6, color: BRAND, fontWeight: 700, fontSize: 14 }}>
                          {fmtRange(dates)} · {dates.length} {dates.length === 1 ? 'screening' : 'screenings'}
                        </p>
                        {places.length > 0 && <p style={{ marginTop: 2, color: MUTED, fontSize: 13, lineHeight: 1.45 }}>{places.join(' · ')}</p>}
                        {dates.some((d) => d.closed_captioned) && <div style={{ marginTop: 8 }}><CCBadge compact /></div>}
                        <span style={{ display: 'inline-block', marginTop: 8, color: BRAND, fontWeight: 700, fontSize: 13 }}>Details &rarr;</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Membership band */}
      <section style={{ background: BRAND }}>
        <div style={{ ...wrap, paddingTop: 40, paddingBottom: 40, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 640 }}>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Become a member of Footcandle Film Society</h2>
            <p style={{ marginTop: 8, color: '#cfe0ef', lineHeight: 1.6 }}>Regular $50/yr · Student $25/yr. Your membership keeps independent film alive in Western North Carolina. Already a member? <Link href="/login" style={{ color: '#fff', textDecoration: 'underline' }}>Sign in to renew.</Link></p>
          </div>
          <Link href="/membership" style={{ ...btnPrimaryLg, background: '#fff', color: BRAND }}>Become a Member</Link>
        </div>
      </section>

      {/* Community events */}
      <section id="screenings" style={{ background: '#fff' }}>
        <div style={wrap}>
          <SectionHead title="Upcoming Community Film Events" sub="Screenings around the area we're proud to help promote — not hosted by the Film Society." />
          {community.length ? (
            <div style={grid3}>
              {community.map((e) => (
                <Link key={e.id} href={`/community/${e.id}`} style={{ ...card, textDecoration: 'none', color: INK, display: 'block' }}>
                  {e.poster_url && <img src={e.poster_url} alt={e.title} style={{ width: '100%', height: 'auto', borderRadius: 8, marginBottom: 12, display: 'block' }} />}
                  <h3 style={{ fontSize: 18, fontWeight: 700 }}>{e.title}</h3>
                  <p style={{ marginTop: 6, color: BRAND, fontWeight: 700, fontSize: 14 }}>{fmtLong(e.event_date, e.event_time)}</p>
                  <p style={{ marginTop: 2, color: MUTED, fontSize: 14 }}>{[e.venue, e.location_city].filter(Boolean).join(' · ')}</p>
                  {e.host_org && <p style={{ marginTop: 8, color: '#8a8a98', fontSize: 13 }}>Presented by {e.host_org}</p>}
                </Link>
              ))}
            </div>
          ) : (
            <div style={emptyBox}>No community events listed right now — check back soon.</div>
          )}
        </div>
      </section>

      {/* Grant */}
      <section style={{ background: TINT }}>
        <div style={{ ...wrap, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 640 }}>
            <p style={kicker}>2026 Filmmaker Grant Fund</p>
            <h2 style={h2}>Making a film in North Carolina? We want to help fund it.</h2>
            <p style={{ marginTop: 12, color: '#374151', lineHeight: 1.6 }}>Our Filmmaker Grant Program supports projects with a majority of their production in North Carolina. Applications for 2026 are open.</p>
          </div>
          <a href={GRANT_URL} target="_blank" rel="noopener noreferrer" style={btnPrimaryLg}>Apply for the grant</a>
        </div>
      </section>

      {/* Podcast */}
      <section style={{ background: '#fff' }}>
        <div style={wrap}>
          <SectionHead title="Listen to the Footcandle Films Podcast" sub="Our conversations about the films we love — new episodes and the full back catalog." />
          <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0,1fr)' }} className="podcast-grid">
            <iframe title="Footcandle Films Podcast" allow="autoplay *; encrypted-media *;" height={450} style={{ width: '100%', maxWidth: 660, overflow: 'hidden', borderRadius: 12, border: '1px solid #e6eaef' }} sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" src={PODCAST_EMBED} />
            <div style={{ alignSelf: 'center' }}>
              <h3 style={{ fontSize: 22, fontWeight: 700 }}>Go deeper</h3>
              <p style={{ marginTop: 10, color: '#4b5563', lineHeight: 1.6, maxWidth: 420 }}>Press play on the latest episode, then browse the full archive of past conversations on Apple Podcasts.</p>
              <a href={PODCAST_APPLE} target="_blank" rel="noopener noreferrer" style={{ ...btnOutlineLg, marginTop: 16, display: 'inline-block' }}>Browse all past episodes</a>
            </div>
          </div>
        </div>
      </section>

      {/* Festival */}
      <section style={{ background: TINT }}>
        <div style={{ ...wrap, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 640 }}>
            <p style={kicker}>Footcandle Film Festival · Sept 18–27, 2026</p>
            <h2 style={h2}>A festival of unique, challenging, and entertaining films.</h2>
            <p style={{ marginTop: 12, color: '#374151', lineHeight: 1.6 }}>Every September in Western North Carolina — competitive screenings, a 60-hour filmmaking competition, and industry symposiums.</p>
          </div>
          <a href={FESTIVAL_URL} target="_blank" rel="noopener noreferrer" style={btnPrimaryLg}>Visit the festival</a>
        </div>
      </section>

      {/* About */}
      <section style={{ background: '#fff' }}>
        <div style={{ ...wrap, maxWidth: 820 }}>
          <SectionHead title="What is Footcandle?" />
          <p style={{ color: '#374151', lineHeight: 1.75, fontSize: 17 }}>
            Footcandle Film Society is a member-supported nonprofit in Catawba County, Western North Carolina. We host monthly
            screenings of documentaries, foreign narratives, and award-nominated movies — each followed by real conversation —
            along with the annual Footcandle Film Festival and a Children's International Film Festival. You like movies. So do we.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/membership" style={btnPrimaryLg}>Become a member</Link>
            <Link href="/login" style={btnOutlineLg}>Member Login</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: BRAND_DARK, color: '#dfe8f1' }}>
        <div style={{ ...wrap, paddingTop: 44, paddingBottom: 28, display: 'flex', flexWrap: 'wrap', gap: 28, justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 320 }}>
            <div style={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: 15, color: '#fff' }}>FOOTCANDLE FILM SOCIETY</div>
            <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: '#aebfd0' }}>Catawba County, Western North Carolina. You like movies. So do we.</p>
          </div>
          <div style={{ display: 'flex', gap: 44, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={footHead}>Explore</span>
              <a href={FESTIVAL_URL} target="_blank" rel="noopener noreferrer" style={footLink}>Film Festival</a>
              <a href={GRANT_URL} target="_blank" rel="noopener noreferrer" style={footLink}>Filmmaker Grant</a>
              <a href={PODCAST_APPLE} target="_blank" rel="noopener noreferrer" style={footLink}>Podcast</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={footHead}>Membership</span>
              <Link href="/membership" style={footLink}>Become a Member</Link>
              <Link href="/login" style={footLink}>Member Login</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={footHead}>Connect</span>
              <a href={FACEBOOK} target="_blank" rel="noopener noreferrer" style={footLink}>Facebook</a>
              <a href={YOUTUBE} target="_blank" rel="noopener noreferrer" style={footLink}>YouTube</a>
              <a href={`mailto:${EMAIL}`} style={footLink}>{EMAIL}</a>
            </div>
          </div>
        </div>
        <div style={{ ...wrap, paddingTop: 0, paddingBottom: 24, color: '#8ea3ba', fontSize: 13 }}>© {new Date().getFullYear()} Footcandle Film Society</div>
      </footer>
    </div>
  )
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={h2}>{title}</h2>
      {sub && <p style={{ marginTop: 8, color: MUTED, maxWidth: 640, lineHeight: 1.5 }}>{sub}</p>}
    </div>
  )
}

const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '60px 24px' }
const h1: React.CSSProperties = { fontSize: 'clamp(28px,4.5vw,42px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', color: INK }
const h2: React.CSSProperties = { fontSize: 'clamp(24px,4vw,32px)', fontWeight: 800, letterSpacing: '-0.01em', color: INK }
const kicker: React.CSSProperties = { textTransform: 'uppercase', letterSpacing: '0.16em', fontSize: 13, fontWeight: 700, color: BRAND, marginBottom: 12 }
const gridFilms: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }
const clamp3: React.CSSProperties = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e6eaef', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(30,63,95,0.06)' }
const emptyBox: React.CSSProperties = { border: '1px dashed #cfd8e3', borderRadius: 12, padding: '32px 20px', color: MUTED, textAlign: 'center', background: '#fafbfc' }
const navLink: React.CSSProperties = { color: '#374151', textDecoration: 'none', fontSize: 15, fontWeight: 500 }
const btnPrimary: React.CSSProperties = { background: BRAND, color: '#fff', fontWeight: 700, padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 14 }
const btnOutline: React.CSSProperties = { color: BRAND, fontWeight: 700, padding: '9px 14px', borderRadius: 8, textDecoration: 'none', fontSize: 14, border: `1.5px solid ${BRAND}` }
const btnPrimaryLg: React.CSSProperties = { background: BRAND, color: '#fff', fontWeight: 700, padding: '13px 24px', borderRadius: 9, textDecoration: 'none', display: 'inline-block' }
const btnOutlineLg: React.CSSProperties = { color: BRAND, fontWeight: 700, padding: '12px 22px', borderRadius: 9, textDecoration: 'none', border: `1.5px solid ${BRAND}`, display: 'inline-block' }
const footHead: React.CSSProperties = { color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 4 }
const footLink: React.CSSProperties = { color: '#aebfd0', textDecoration: 'none', fontSize: 14 }
