// Diagnostic: check User table state + verify demo credentials end-to-end.
// Mirrors what /api/auth/login → authenticate() does, so we can see exactly
// which step fails (missing user? bad hash? wrong password?).
import { PrismaClient } from '@prisma/client'
import { scryptSync, timingSafeEqual } from 'node:crypto'

const db = new PrismaClient()

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const expectedHex = parts[2]
  if (salt == null || expectedHex == null) return false
  const computed = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

async function main() {
  const users = await db.user.findMany({
    select: { id: true, email: true, role: true, name: true, passwordHash: true },
  })
  console.log(`User count: ${users.length}`)
  for (const u of users) {
    const hashPreview = u.passwordHash
      ? `${u.passwordHash.slice(0, 20)}... (len=${u.passwordHash.length}, algo=${u.passwordHash.split(':')[0]})`
      : 'NULL / EMPTY'
    console.log(`- ${u.email} | role=${u.role} | name=${u.name} | hash=${hashPreview}`)
  }

  // Try the documented demo credentials
  const demo = users.find((u) => u.email === 'admin@gavel.demo')
  if (!demo) {
    console.log('\n>>> admin@gavel.demo NOT FOUND in User table')
  } else if (!demo.passwordHash) {
    console.log('\n>>> admin@gavel.demo exists but passwordHash is NULL')
  } else {
    const ok = await verifyPassword('gavel-admin-demo', demo.passwordHash)
    console.log(`\n>>> verifyPassword('gavel-admin-demo') → ${ok}`)
    if (!ok) {
      const parts = demo.passwordHash.split(':')
      console.log(`    stored algo=${parts[0]}, salt=${parts[1]?.slice(0, 8)}..., hashLen=${parts[2]?.length}`)
    }
  }

  // Sanity: row counts of key tables
  const counts = {
    clients: await db.client.count(),
    projects: await db.project.count(),
    findings: await db.finding.count(),
    invoices: await db.invoice.count(),
  }
  console.log('\nTable counts:', JSON.stringify(counts))
}

main()
  .catch((e) => {
    console.error('DIAG ERROR:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
