// Resolve a signed invitation token (/newmember?invite=…) to the prospect's
// name + email so the join form can be pre-filled. Public; the token is the
// only key, and it reveals nothing beyond what the invitation email held.
import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/email'
import { inquiryIdFromToken } from '@/lib/invite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = inquiryIdFromToken(new URL(req.url).searchParams.get('t'))
  if (!id || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 })
  const { data } = await admin().from('membership_inquiries').select('name,email').eq('id', id).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 })
  return NextResponse.json({ name: data.name || '', email: data.email || '' })
}
