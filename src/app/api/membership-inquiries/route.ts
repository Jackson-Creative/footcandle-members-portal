// Admin-only: list and update membership interest submissions (service role).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON } from '@/lib/supabaseConfig'
import { admin } from '@/lib/email'
import { isAdmin } from '@/lib/admin'
import { activeMemberEmails } from '@/lib/invite'

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await createClient(SUPABASE_URL, SUPABASE_ANON).auth.getUser(token)
  return data.user && isAdmin(data.user.email) ? data.user : null
}

export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { data, error } = await admin().from('membership_inquiries').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // is_member: this email now belongs to an active member (joined, whether or
  // not they used their invitation link).
  const members = await activeMemberEmails((data || []).map((i: any) => i.email || ''))
  return NextResponse.json({ inquiries: (data || []).map((i: any) => ({ ...i, is_member: members.has(String(i.email || '').toLowerCase()) })) })
}

export async function PATCH(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { id, handled } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await admin().from('membership_inquiries').update({ handled: !!handled }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
