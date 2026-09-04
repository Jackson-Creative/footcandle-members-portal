// Public film detail page — generated for each published film screening.
// Layout: poster + all dates/locations side-by-side up top; summary and
// description full-width beneath; embedded trailer under that.
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const revalidate = 60

const BRAND = '#2a5680'
const INK = '#1f2937'
const MUTED = '#5b6472'

type DateRow = { screening_date: string; screening_time: string | null; venue: string | null; location_city: string | null; address: string | null; closed_captioned?: boolean | null }
type Film = {
  id: string; title: string; description: string | null; about_film: string | null; poster_url: string | null
  rating: string | null; running_time: string | null; trailer_url: string | null; published: boolean
  screening_dates: DateRow[] | null
}

function fmtLong(dateStr: string, timeStr?: string | null) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!timeStr) return day
  const [h, m] = timeStr.split(':')
  return `${day} · ${((+h + 11) % 12) + 1}:${m} ${+h >= 12 ? 'PM' : 'AM'}`
}
function dateKey(d: DateRow) { return d.screening_date + (d.screening_time || '') }

// Convert a YouTube/Vimeo URL to an embeddable player URL (null if unknown).
function trailerEmbed(url: string | null): string | null {
  if (!url) return null
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)
  if (m) return `https://www.youtube.com/embed/${m[1]}`
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (m) return `https://player.vimeo.com/video/${m[1]}`
  return null
}

async function getFilm(id: string): Promise<Film | null> {
  const { data, error } = await supabase
    .from('film_screenings')
    .select('id,title,description,about_film,poster_url,rating,running_time,trailer_url,published,screening_dates(*)')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as Film
}

export default async function FilmPage({ params }: { params: { id: string } }) {
  const film = await getFilm(params.id)
  const embed = film ? trailerEmbed(film.trailer_url) : null

  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #e6eaef' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '16px 24px' }}>
          <Link href="/"><img src="/footcandle-logo.png" alt="Footcandle Film Society" style={{ height: 66, width: 'auto', display: 'block' }} /></Link>
        </div>
      </nav>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '36px 24px 72px' }}>
        <Link href="/" style={{ color: BRAND, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>← Back to home</Link>

        {!film || !film.published ? (
          <div style={{ marginTop: 40, textAlign: 'center', color: MUTED }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: INK }}>Screening not found</h1>
            <p style={{ marginTop: 10 }}>This screening may have been removed or isn't published yet.</p>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 'clamp(30px,5vw,44px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 20 }}>{film.title}</h1>
            {(film.rating || film.running_time) && (
              <p style={{ marginTop: 8, color: MUTED, fontSize: 15 }}>{[film.rating, film.running_time].filter(Boolean).join(' · ')}</p>
            )}

            {/* Poster + dates, side by side */}
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 24 }}>
              {film.poster_url && (
                <img src={film.poster_url} alt={film.title} style={{ width: '100%', maxWidth: 300, borderRadius: 14, boxShadow: '0 16px 44px rgba(30,63,95,0.22)' }} />
              )}
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Screening dates &amp; locations</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(film.screening_dates || []).slice().sort((a, b) => dateKey(a).localeCompare(dateKey(b))).map((d, i) => (
                    <div key={i} style={{ background: '#f7f9fc', border: '1px solid #dbe3ec', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, color: BRAND }}>{fmtLong(d.screening_date, d.screening_time)}</div>
                      <div style={{ color: MUTED, fontSize: 14, marginTop: 3 }}>{[d.venue, d.location_city].filter(Boolean).join(' · ')}{d.address ? ` — ${d.address}` : ''}</div>
                      {d.closed_captioned && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, fontWeight: 700, color: '#8a5a00', background: '#fdf0d5', border: '1px solid #e6b34d', borderRadius: 6, padding: '3px 9px', letterSpacing: 0.2 }}>
                          <span style={{ fontWeight: 800, background: '#8a5a00', color: '#fdf0d5', borderRadius: 3, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}>CC</span>
                          Closed Captioned
                        </span>
                      )}
                    </div>
                  ))}
                  {(!film.screening_dates || film.screening_dates.length === 0) && (
                    <p style={{ color: MUTED }}>Dates will be announced soon.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Summary + description, full width */}
            {(film.description || film.about_film) && (
              <div style={{ marginTop: 40 }}>
                {film.description && <p style={{ fontSize: 18, color: '#374151', lineHeight: 1.6 }}>{film.description}</p>}
                {film.about_film && <p style={{ marginTop: 16, color: '#374151', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{film.about_film}</p>}
              </div>
            )}

            {/* Trailer, full width */}
            {embed ? (
              <div style={{ marginTop: 36 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>Trailer</h2>
                <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                  <iframe
                    src={embed}
                    title={`${film.title} trailer`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              </div>
            ) : film.trailer_url ? (
              <a href={film.trailer_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 28, color: BRAND, fontWeight: 700, textDecoration: 'none' }}>▶ Watch the trailer</a>
            ) : null}

            <div style={{ marginTop: 40 }}>
              <Link href="/membership" style={{ background: BRAND, color: '#fff', fontWeight: 700, padding: '13px 24px', borderRadius: 9, textDecoration: 'none' }}>Become a member</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
