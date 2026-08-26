import { PrismaClient, type AuditLog } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Gate query logging behind NODE_ENV === 'development'. In production we
 * only log errors and warnings — otherwise stdout floods with parameter
 * bindings (PII + perf risk).
 */
const logLevel: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn']

/**
 * Immutability guard for the AuditLog table.
 *
 * In production, all update/delete operations on `auditLog` are blocked
 * at the Prisma-client layer. This is the documented trust anchor
 * (§10 of the product plan) — once written, an audit entry must never
 * change.
 *
 * In development, mutations are allowed so the seed script can clean
 * up before re-inserting.
 *
 * NOTE: this is defense-in-depth at the application layer. A truly
 * immutable log also needs DB-level triggers / row-level locks. Add
 * those when migrating to Postgres.
 */
function withImmutabilityGuard(client: PrismaClient) {
  if (process.env.NODE_ENV !== 'production') return client
  return client.$extends({
    name: 'auditLogImmutable',
    query: {
      auditLog: {
        update: () => {
          throw new Error('AuditLog is immutable — update() is not allowed in production')
        },
        updateMany: () => {
          throw new Error('AuditLog is immutable — updateMany() is not allowed in production')
        },
        delete: () => {
          throw new Error('AuditLog is immutable — delete() is not allowed in production')
        },
        deleteMany: () => {
          throw new Error('AuditLog is immutable — deleteMany() is not allowed in production')
        },
        upsert: () => {
          throw new Error('AuditLog is immutable — upsert() is not allowed in production')
        },
      },
    },
  })
}

const baseClient = globalForPrisma.prisma ?? new PrismaClient({ log: logLevel })

// Cast: the $extends return type differs from PrismaClient but is structurally
// compatible for all the callsites we use. We keep the broader PrismaClient
// type so existing imports keep working.
export const db: PrismaClient = (process.env.NODE_ENV === 'production'
  ? withImmutabilityGuard(baseClient)
  : baseClient) as PrismaClient

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient

export type { AuditLog }
