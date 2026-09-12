// Next.js instrumentation hook — runs once when the server process starts
// (dev: `next dev`, prod: standalone server), BEFORE any request is served.
//
// Purpose: sandbox self-heal (src/lib/bootstrap.ts). The sandbox recreates
// the SQLite file empty on restart; without this hook the documented demo
// credentials on /login stop working and there is no in-app path back
// (POST /api/seed needs an authenticated admin — chicken-and-egg on an
// empty User table).
//
// Failure containment: the bootstrap is fire-and-forget with an explicit
// catch. A broken/missing DB at startup must NOT prevent the server from
// booting — health endpoints and error pages still need to respond, and
// the login route has its own retry-on-missing-user path that will retry
// the bootstrap per-request until the DB is writable.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return // skip the edge bundle
  try {
    const { ensureDemoData } = await import('./lib/bootstrap')
    // Fire-and-forget: do not block server start on DB availability.
    void ensureDemoData().catch((err: unknown) => {
      console.warn('GAVEL instrumentation: demo self-heal skipped —', err instanceof Error ? err.message : err)
    })
  } catch (err: unknown) {
    console.warn('GAVEL instrumentation: bootstrap module failed to load —', err instanceof Error ? err.message : err)
  }
}
