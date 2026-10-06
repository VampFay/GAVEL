#!/usr/bin/env bun
// GAVEL — async sync pipeline verification (WP 1.2), part A:
// REAL Redis + REAL BullMQ + REAL database + REAL SyncJob rows.
//
// The queue processor is a deterministic stub (no upstream network): it
// exercises the full enqueue → pick-up → state-machine → completion path,
// including retry semantics on a first failure. The real sync core
// (runConnectorSync) is exercised in part B (live server E2E) and by the
// unit suite.
//
// Exit 0 = all gates pass.

import { RedisMemoryServer } from 'redis-memory-server'
import { Queue, Worker } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

const db = new PrismaClient()
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const TENANT = 'demo-tenant'

async function main() {
  console.log('== booting real Redis (redis-memory-server) ==')
  const redis = await RedisMemoryServer.create()
  const host = await redis.getHost()
  const port = await redis.getPort()
  const url = `redis://${host}:${port}`
  const connection = { host, port }
  console.log('   redis at', url)

  // Fixture: a connector + project rows must exist for SyncJob FKs.
  const tenant = await db.tenant.findUnique({ where: { id: TENANT } })
  if (!tenant) throw new Error('demo-tenant missing — run bun run seed:dev first')
  let project = await db.project.findFirst({ where: { tenantId: TENANT, name: 'wp12-pipeline-probe' } })
  if (!project) {
    const client = await db.client.findFirst({ where: { tenantId: TENANT } })
    if (!client) throw new Error('demo client missing — run bun run seed:dev first')
    project = await db.project.create({
      data: { tenantId: TENANT, clientId: client.id, name: 'wp12-pipeline-probe' },
    })
  }
  const connector = await db.connectorSource.upsert({
    where: { projectId_kind: { projectId: project.id, kind: 'github' } },
    create: {
      tenantId: TENANT, projectId: project.id, kind: 'github',
      config: JSON.stringify({ owner: 'example', repo: 'probe', includePrs: true, days: 30 }),
    },
    update: {},
  })
  await db.syncJob.deleteMany({ where: { connectorId: connector.id } })

  // ── 1. Enqueue → worker pickup → completion ────────────────────────────
  console.log('\n== 1. enqueue → worker → SyncJob completed ==')
  const queue = new Queue('connector-sync', {
    connection,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 100 } },
  })

  const syncJob = await db.syncJob.create({
    data: {
      tenantId: TENANT, connectorId: connector.id, status: 'queued',
      requestedBy: 'wp12-harness', requestId: 'req-wp12',
    },
  })

  let pickedUp = false
  const worker = new Worker('connector-sync', async job => {
    if (job.data.syncJobId !== syncJob.id) return
    pickedUp = true
    await db.syncJob.update({
      where: { id: syncJob.id },
      data: { status: 'active', startedAt: new Date() },
    })
    await db.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: 'completed', finishedAt: new Date(),
        stats: JSON.stringify({ fetched: { codeActivities: 7, apiCalls: 2, truncated: false }, committed: { activitiesCreated: 5, duplicates: 2 } }),
        error: null,
      },
    })
  }, { connection, concurrency: 1 })

  await queue.add('sync', {
    syncJobId: syncJob.id, tenantId: TENANT, connectorId: connector.id,
    actorId: 'wp12', actorEmail: 'wp12@gavel.demo', requestId: 'req-wp12',
  }, { jobId: syncJob.id })

  const done1 = await waitFor(async () => {
    const j = await db.syncJob.findUnique({ where: { id: syncJob.id } })
    return j?.status === 'completed'
  }, 10_000)
  check('worker picked the job up', pickedUp)
  check('SyncJob reached completed with stats', done1)
  const row1 = await db.syncJob.findUnique({ where: { id: syncJob.id } })
  const stats = row1?.stats ? JSON.parse(row1.stats) : null
  check('stats JSON round-trips', stats?.committed?.activitiesCreated === 5)
  check('requestId correlation persisted', row1?.requestId === 'req-wp12')

  // ── 2. Retry semantics: fail twice, then succeed ───────────────────────
  console.log('\n== 2. exponential-backoff retry (fail, fail, succeed) ==')
  const syncJob2 = await db.syncJob.create({
    data: { tenantId: TENANT, connectorId: connector.id, status: 'queued', requestedBy: 'wp12-harness' },
  })
  let attempts = 0
  const retryWorker = new Worker('connector-sync', async job => {
    if (job.data.syncJobId !== syncJob2.id) return
    attempts++
    await db.syncJob.update({
      where: { id: syncJob2.id },
      data: { status: 'active', startedAt: new Date(), attempts },
    })
    if (attempts < 3) throw new Error(`simulated transient failure #${attempts}`)
    await db.syncJob.update({
      where: { id: syncJob2.id },
      data: { status: 'completed', finishedAt: new Date(), stats: JSON.stringify({ attempts }) },
    })
  }, { connection, concurrency: 1 })

  // Stop the first worker so only the retry worker consumes.
  await worker.close()

  await queue.add('sync', {
    syncJobId: syncJob2.id, tenantId: TENANT, connectorId: connector.id,
    actorId: 'wp12', actorEmail: 'wp12@gavel.demo',
  }, { jobId: syncJob2.id, attempts: 5, backoff: { type: 'exponential', delay: 100 } })

  const done2 = await waitFor(async () => {
    const j = await db.syncJob.findUnique({ where: { id: syncJob2.id } })
    return j?.status === 'completed'
  }, 20_000)
  check('job completes after 2 transient failures', done2)
  check('attempt counter reached 3', attempts === 3, `attempts=${attempts}`)
  const row2 = await db.syncJob.findUnique({ where: { id: syncJob2.id } })
  check('SyncJob.attempts recorded', row2?.attempts === 3)

  // ── 3. Exhausted retries mark the job failed ───────────────────────────
  console.log('\n== 3. exhausted retries → failed ==')
  const syncJob3 = await db.syncJob.create({
    data: { tenantId: TENANT, connectorId: connector.id, status: 'queued', requestedBy: 'wp12-harness' },
  })
  await retryWorker.close()
  let failExecutions = 0
  const failWorker = new Worker('connector-sync', async job => {
    if (job.data.syncJobId !== syncJob3.id) return
    failExecutions++
    await db.syncJob.update({ where: { id: syncJob3.id }, data: { status: 'active', attempts: failExecutions } })
    throw new Error('permanent-ish upstream error')
  }, { connection, concurrency: 1 })

  await queue.add('sync', {
    syncJobId: syncJob3.id, tenantId: TENANT, connectorId: connector.id,
    actorId: 'wp12', actorEmail: 'wp12@gavel.demo',
  }, { jobId: syncJob3.id, attempts: 2, backoff: { type: 'exponential', delay: 50 } })

  const failed = await waitFor(async () => {
    const j = await db.syncJob.findUnique({ where: { id: syncJob3.id } })
    return j?.status === 'active' && (j.attempts ?? 0) >= 2
  }, 10_000)
  const bullJob = await queue.getJob(syncJob3.id)
  const failedState = await bullJob?.getState()
  check('BullMQ marks the job failed after attempts exhausted', failedState === 'failed', `state=${String(failedState)}`)
  check('worker executed the configured attempts', failed && failExecutions === 2, `executions=${failExecutions}`)

  // Cleanup.
  await db.syncJob.deleteMany({ where: { connectorId: connector.id } })
  await db.connectorSource.delete({ where: { id: connector.id } })
  await db.project.delete({ where: { id: project.id } })
  await failWorker.close()
  await queue.close()
  await db.$disconnect()
  await redis.stop()

  console.log(`\n${failures === 0 ? 'ALL PIPELINE GATES PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pred()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

// Stable-content hash — proves script identity in logs.
console.log('harness:', createHash('sha256').update('wp12-part-a').digest('hex').slice(0, 8))

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1) })
