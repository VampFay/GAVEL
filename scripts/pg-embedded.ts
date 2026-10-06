#!/usr/bin/env bun
// GAVEL — embedded PostgreSQL 16 booter (WP 1.1).
//
// The no-Docker path to dev/prod database parity: boots a REAL PostgreSQL
// 16 cluster (same major version as the postgres:16-alpine dev container)
// from the @embedded-postgres/linux-x64 binaries, provisions the two-role
// security model (gavel_owner / gavel_app — see scripts/pg/init-roles.sql),
// and prints the connection URLs.
//
// Used by:
//   * developers without Docker:  bun scripts/pg-embedded.ts start|stop
//   * CI + the parity harness:   scripts/verify-db-parity.ts (programmatic)
//   * the RLS integration tests: tests/unit/rls-integration.test.ts
//
// The cluster lives in .pg-embedded/ (gitignored). Data persists across
// restarts for the same project path; `reset` wipes it.

import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const BIN = join(ROOT, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin')
const DATA_DIR = join(ROOT, '.pg-embedded', 'cluster')
const LOG_FILE = join(ROOT, '.pg-embedded', 'postgres.log')

export interface EmbeddedPg {
  port: number
  appUrl: string
  ownerUrl: string
  superUrl: string
  stop: () => void
}

function freePort(): number {
  // Cheap ephemeral port probe; race-safe enough for a dev/CI booter.
  const s = spawnSync('python3', ['-c', 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'])
  return Number(s.stdout.toString().trim()) || 55432
}

function run(cmd: string, args: string[], opts: Record<string, unknown> = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: childEnv(), ...opts })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`)
  }
  return r
}

/**
 * PG 16 binaries link ICU 60 (libicuuc.so.60). Modern distros ship a newer
 * soname, so .pg-embedded/libs/ carries a pinned copy (fetched on demand by
 * scripts/pg-fetch-icu.sh). Prepending it to LD_LIBRARY_PATH keeps the
 * embedded cluster self-contained and identical everywhere.
 */
function childEnv(): NodeJS.ProcessEnv {
  const libs = join(ROOT, '.pg-embedded', 'libs')
  const existing = process.env.LD_LIBRARY_PATH
  return { ...process.env, LD_LIBRARY_PATH: existing ? `${libs}:${existing}` : libs }
}

async function waitForPostgres(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const c = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' })
      await c.connect()
      await c.end()
      return
    } catch {
      await new Promise(r => setTimeout(r, 300))
    }
  }
  throw new Error(`embedded postgres did not become ready within ${timeoutMs}ms (log: ${LOG_FILE})`)
}

/**
 * Boot (or reuse) an embedded PG 16 cluster with the GAVEL role model.
 * Idempotent: a cluster that is already up on the recorded port is reused.
 */
export async function bootEmbeddedPg(): Promise<EmbeddedPg> {
  if (!existsSync(BIN)) {
    throw new Error(
      'embedded PG binaries missing — run `bun install` (devDependency ' +
      '@embedded-postgres/linux-x64 provides them)'
    )
  }
  mkdirSync(dirname(DATA_DIR), { recursive: true })

  const stateFile = join(ROOT, '.pg-embedded', 'state.json')
  let state: { port: number; ownerPw: string; appPw: string } | null = null
  if (existsSync(stateFile)) {
    try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { state = null }
  }

  const fresh = !existsSync(join(DATA_DIR, 'PG_VERSION'))
  if (fresh) {
    state = null // old state cannot match a fresh cluster
  }
  if (!state) {
    state = {
      port: freePort(),
      ownerPw: randomBytes(12).toString('hex'),
      appPw: randomBytes(12).toString('hex'),
    }
  }

  if (fresh) {
    run(join(BIN, 'initdb'), [
      '-D', DATA_DIR,
      '-U', 'postgres',
      '-A', 'trust', // local dev/CI only; the gavel roles use passwords
      '-E', 'UTF8',
      '--no-instructions' as unknown as string,
    ])
  }

  const isUp = await (async () => {
    try {
      const c = new Client({ host: '127.0.0.1', port: state!.port, user: 'postgres', database: 'postgres' })
      await c.connect()
      await c.end()
      return true
    } catch { return false }
  })()

  if (!isUp) {
    const logFd = await import('node:fs').then(fs => fs.openSync(LOG_FILE, 'a'))
    const child = spawn(join(BIN, 'postgres'), [
      '-D', DATA_DIR,
      '-p', String(state.port),
      '-k', join(ROOT, '.pg-embedded'),
      '-c', 'listen_addresses=127.0.0.1',
    ], { stdio: ['ignore', logFd, logFd], detached: true, env: childEnv() })
    child.unref()
    await waitForPostgres(state.port)
  }

  const superC = new Client({ host: '127.0.0.1', port: state.port, user: 'postgres', database: 'postgres' })
  await superC.connect()
  try {
    // Database + roles (idempotent — mirrors scripts/pg/init-roles.sql).
    const dbExists = await superC.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT FROM pg_database WHERE datname = 'gavel') AS exists"
    )
    if (!dbExists.rows[0]!.exists) {
      await superC.query('CREATE DATABASE gavel')
    }
    await superC.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gavel_owner') THEN
        CREATE ROLE gavel_owner LOGIN PASSWORD '${state.ownerPw}';
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gavel_app') THEN
        CREATE ROLE gavel_app LOGIN PASSWORD '${state.appPw}';
      END IF;
    END $$;`)
    await superC.query('GRANT CONNECT ON DATABASE gavel TO gavel_owner, gavel_app')
    // Database-level CREATE: migration 0001 issues CREATE SCHEMA IF NOT
    // EXISTS "public", which needs it (not just schema-level CREATE).
    await superC.query('GRANT CREATE ON DATABASE gavel TO gavel_owner')
  } finally {
    await superC.end()
  }

  const gavelC = new Client({ host: '127.0.0.1', port: state.port, user: 'postgres', database: 'gavel' })
  await gavelC.connect()
  try {
    await gavelC.query('GRANT USAGE, CREATE ON SCHEMA public TO gavel_owner')
    await gavelC.query('GRANT USAGE ON SCHEMA public TO gavel_app')
  } finally {
    await gavelC.end()
  }

  const { writeFileSync } = await import('node:fs')
  writeFileSync(stateFile, JSON.stringify(state))

  const host = '127.0.0.1'
  return {
    port: state.port,
    superUrl: `postgresql://postgres@${host}:${state.port}/gavel`,
    ownerUrl: `postgresql://gavel_owner:${state.ownerPw}@${host}:${state.port}/gavel`,
    appUrl: `postgresql://gavel_app:${state.appPw}@${host}:${state.port}/gavel`,
    stop: () => {
      run(join(BIN, 'pg_ctl'), ['-D', DATA_DIR, 'stop', '-m', 'fast'])
    },
  }
}

// ── CLI (only when run directly, not when imported by the parity harness) ──

if (import.meta.main) {
  const command = process.argv[2]
  if (command === 'start') {
    const pg = await bootEmbeddedPg()
    console.log('embedded PostgreSQL 16 up')
    console.log(`  DATABASE_URL=${pg.appUrl}`)
    console.log(`  OWNER_DATABASE_URL=${pg.ownerUrl}`)
  } else if (command === 'stop') {
    if (existsSync(join(DATA_DIR, 'postmaster.pid'))) {
      run(join(BIN, 'pg_ctl'), ['-D', DATA_DIR, 'stop', '-m', 'fast'])
      console.log('stopped')
    } else {
      console.log('not running')
    }
  } else if (command === 'reset') {
    if (existsSync(join(DATA_DIR, 'postmaster.pid'))) {
      run(join(BIN, 'pg_ctl'), ['-D', DATA_DIR, 'stop', '-m', 'immediate'])
    }
    rmSync(join(ROOT, '.pg-embedded'), { recursive: true, force: true })
    console.log('cluster wiped (.pg-embedded/)')
  } else {
    console.error('usage: bun scripts/pg-embedded.ts start|stop|reset')
    process.exit(1)
  }
}
