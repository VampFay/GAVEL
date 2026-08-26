import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const { stdout, stderr } = await execAsync('bun run scripts/seed.ts', {
      cwd: '/home/z/my-project',
      timeout: 60_000,
    })
    return NextResponse.json({
      ok: true,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-1000),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'seed failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
