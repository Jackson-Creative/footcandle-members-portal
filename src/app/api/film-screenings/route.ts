// Admin-only management of film screenings + their dates (service role).
// PATCH {id}: edit a film's fields.  PATCH {dateId}: edit one screening date.
// POST: add a screening date.   DELETE ?id=…: delete a film (dates cascade).
// DELETE ?dateId=…: delete one screening date.
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin } from '@/lib/email'
import { isAdmin } from '@/lib/admin'

// Refresh the public pages that show screenings.
function refreshPublic() {
  revalidatePath('/')
  revalidatePath('/film/[id]', 'page')
}

const FILM_FIELDS = ['title', 'poster_url', 'description', 'about_film', 'rating', 'running_time', 'trailer_url', 'published'] as const
const DATE_FIELDS = ['screening_date', 'screening_time', 'venue', 'location_city', 'address', 'closed_captioned'] as const

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user && isAdmin(data.user.email) ? data.user : null
}
function clean(input: any, fields: readonly string[]) {
  const out: Record<string, any> = {}
  for (const k of fields) if (k in (input || {})) out[k] = input[k] === '' ? null : input[k]
  return out
}
function guard() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? null : NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
}

export async function PATCH(req: NextRequest) {
  const g = guard(); if (g) return g
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { id, dateId, updates } = await req.json().catch(() => ({}))
  if (!updates) return NextResponse.json({ error: 'updates required' }, { status: 400 })
  // dateId → update one screening date; id → update a film's fields.
  if (dateId) {
    const { data, error } = await admin().from('screening_dates').update(clean(updates, DATE_FIELDS)).eq('id', dateId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    refreshPublic()
    return NextResponse.json({ date: data })
  }
  if (!id) return NextResponse.json({ error: 'id or dateId required' }, { status: 400 })
  const { data, error } = await admin().from('film_screenings').update(clean(updates, FILM_FIELDS)).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  refreshPublic()
  return NextResponse.json({ film: data })
}

export async function POST(req: NextRequest) {
  const g = guard(); if (g) return g
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { film_screening_id, date } = await req.json().catch(() => ({}))
  if (!film_screening_id || !date?.screening_date) return NextResponse.json({ error: 'film_screening_id and screening_date required' }, { status: 400 })
  const row = { film_screening_id, ...clean(date, DATE_FIELDS) }
  const { data, error } = await admin().from('screening_dates').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  refreshPublic()
  return NextResponse.json({ date: data })
}

export async function DELETE(req: NextRequest) {
  const g = guard(); if (g) return g
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const url = new URL(req.url)
  const dateId = url.searchParams.get('dateId')
  const id = url.searchParams.get('id')
  if (dateId) {
    const { error } = await admin().from('screening_dates').delete().eq('id', dateId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    refreshPublic()
    return NextResponse.json({ ok: true })
  }
  if (id) {
    const { error } = await admin().from('film_screenings').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    refreshPublic()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'id or dateId required' }, { status: 400 })
}
