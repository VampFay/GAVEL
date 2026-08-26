import { Prisma } from '@prisma/client'

/**
 * Money helpers.
 *
 * Schema: every currency field is `Decimal` (not Float) — see prisma/schema.prisma.
 * Prisma returns these as `Prisma.Decimal` instances on read. JSON-serializing a
 * Decimal directly produces a string (e.g. "700000") which is actually the
 * *safest* money transport for HTTP, but the existing client code
 * (`formatINR(n: number)`) and dashboard arithmetic expect JS numbers.
 *
 * Strategy:
 *   - At the API response boundary, convert Decimal → number with `money()`.
 *     For amounts up to 9,007,199,254,740,991.99 (Number.MAX_SAFE_INTEGER),
 *     this is lossless. A tool tracking INR at 2-decimal precision won't
 *     exceed that.
 *   - For SUM / aggregate arithmetic that needs to avoid float drift, use
 *     `sumMoney()` which accumulates in Decimal.js (bundled with Prisma)
 *     and only converts the final result to a number.
 *
 * If you find a code path that does `+=` on a Prisma.Decimal, replace it with
 * `sumMoney()` — Prisma.Decimal has no `+` operator and TS will flag it.
 */

export type MoneyInput = Prisma.Decimal | number | string | null | undefined

/**
 * Convert a Decimal/number/string/null to a plain JS number.
 * Returns null for null/undefined/NaN — never throws.
 */
export function money(d: MoneyInput): number | null {
  if (d == null) return null
  try {
    if (d instanceof Prisma.Decimal) {
      const n = Number(d.toString())
      return Number.isFinite(n) ? n : null
    }
    if (typeof d === 'number') {
      return Number.isFinite(d) ? d : null
    }
    if (typeof d === 'string') {
      const n = Number(d)
      return Number.isFinite(n) ? n : null
    }
  } catch {
    return null
  }
  return null
}

/**
 * Convert a Decimal/number/null to a Prisma.Decimal suitable for writes.
 * Returns null for null/undefined so callers can pass through optionals.
 *
 * Usage in routes:
 *   await db.invoice.create({ data: { total: toDecimal(rawValue) } })
 */
export function toDecimal(d: MoneyInput): Prisma.Decimal | null {
  if (d == null) return null
  if (d instanceof Prisma.Decimal) return d
  const n = typeof d === 'number' ? d : Number(d)
  if (!Number.isFinite(n)) return null
  return new Prisma.Decimal(n)
}

/**
 * Sum an array of money values without IEEE-754 drift.
 * Accumulates in Decimal.js, converts the total to a number at the end.
 *
 * Use this for any server-side aggregate over money fields:
 *   const totalImpact = sumMoney(findings.map(f => f.impactAmount))
 */
export function sumMoney(values: MoneyInput[]): number {
  let acc = new Prisma.Decimal(0)
  for (const v of values) {
    if (v == null) continue
    try {
      const d = v instanceof Prisma.Decimal ? v : new Prisma.Decimal(String(v))
      acc = acc.plus(d)
    } catch {
      // skip unparseable values
    }
  }
  const n = Number(acc.toString())
  return Number.isFinite(n) ? n : 0
}
