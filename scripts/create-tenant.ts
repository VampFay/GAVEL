// GAVEL — tenant + admin bootstrap CLI (production blocker #2/#3 companion).
//
// Usage:
//   bun scripts/create-tenant.ts "Acme Consulting" acme \
//     --admin "founder@acme.com" "Priya Sharma" \
//     [--invite]          # print a ready-to-share invite link
//     [--base-url https://gavel.acme.com]
//
// What it does:
//   1. creates the Tenant (idempotent on slug)
//   2. creates the tenant's first admin user (idempotent on email — an
//      existing user is attached to the tenant instead of duplicated)
//   3. prints a one-time invite link the admin uses to set their password
//
// This is the platform-operator entry point: tenants are NOT creatable via
// the API (that is a deliberate decision — bringing a whole organisation
// onto the platform is a billing/legal step, not a UI click). Once the
// first admin is in, everything else (inviting their team) happens in the
// Team view inside the app.
//
// Never runs in production-schema terms: safe to run any time; refuses to
// modify an existing tenant except to no-op.

import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { signPurposeToken } from '../src/lib/auth'

// WP 1.1: provisioning is a SYSTEM operation — connect as the table owner
// (gavel_owner) when provisioned, so it is never impeded by the RLS layer.
const ownerUrl = process.env.OWNER_DATABASE_URL
if (ownerUrl) console.log('create-tenant: using OWNER_DATABASE_URL (bypasses RLS)')
const db = new PrismaClient(ownerUrl ? { datasources: { db: { url: ownerUrl } } } : undefined)

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const [name, slug] = [process.argv[2], process.argv[3]]
  const adminEmail = arg('--admin')
  const adminName = arg('--admin-name') ?? adminEmail?.split('@')[0]
  const baseUrl = arg('--base-url') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
  const wantsInvite = process.argv.includes('--invite')

  if (!name || !slug || !adminEmail) {
    console.error(
      'usage: bun scripts/create-tenant.ts "<tenant name>" <slug> --admin <email> [--admin-name "<name>"] [--invite] [--base-url <url>]'
    )
    process.exit(1)
  }
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    console.error('slug must be lowercase alphanumeric + dashes (2-60 chars)')
    process.exit(1)
  }

  // 1. Tenant (idempotent on slug).
  const tenant = await db.tenant.upsert({
    where: { slug },
    create: { id: `tenant-${slug}-${randomBytes(4).toString('hex')}`, name, slug },
    update: { name },
  })

  // 2. First admin (idempotent on email).
  const existing = await db.user.findUnique({ where: { email: adminEmail.toLowerCase() } })
  let admin
  if (existing) {
    if (existing.tenantId !== tenant.id) {
      // Attach to this tenant (a user belongs to exactly one tenant).
      admin = await db.user.update({
        where: { id: existing.id },
        data: { tenantId: tenant.id, role: 'admin' },
      })
      console.log(`attached existing user ${adminEmail} to tenant ${slug} as admin`)
    } else {
      admin = existing
      console.log(`admin ${adminEmail} already exists in tenant ${slug}`)
    }
  } else {
    admin = await db.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail.toLowerCase(),
        name: adminName ?? null,
        role: 'admin',
        passwordHash: null, // set via invite link
        status: 'active',
      },
    })
    console.log(`created admin ${adminEmail} in tenant ${slug}`)
  }

  // 3. Invite link.
  const token = signPurposeToken('invite', admin.id)
  const path = `/login?invite=${encodeURIComponent(token)}`
  console.log('\nInvite link (valid 72h — deliver over a secure channel):')
  console.log(`  ${baseUrl}${path}`)
  if (!wantsInvite && !baseUrl) {
    console.log('\n(no --base-url given — prefix the path above with your public URL when sharing)')
  }

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: 'platform-cli',
      action: 'tenant_created',
      entityType: 'tenant',
      entityId: tenant.id,
      detail: `Tenant "${name}" (slug ${slug}) bootstrapped via create-tenant CLI; admin ${adminEmail}`,
    },
  })
}

main()
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    void db.$disconnect()
    process.exit(1)
  })
