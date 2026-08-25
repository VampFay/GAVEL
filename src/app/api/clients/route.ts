import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const clients = await db.client.findMany({ select: { id: true, name: true, industry: true, sizeBand: true } })
  return NextResponse.json({ ok: true, clients })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { name, industry, sizeBand, contactName, contactEmail } = body as {
    name: string
    industry?: string
    sizeBand?: string
    contactName?: string
    contactEmail?: string
  }
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  const c = await db.client.create({
    data: { name, industry, sizeBand, contactName, contactEmail },
  })
  return NextResponse.json({ ok: true, client: c })
}
