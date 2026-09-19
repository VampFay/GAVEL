// GAVEL — connector framework types (production blocker #4).
//
// A connector is: a per-project saved config (ConnectorSource row) + a
// fetcher that pulls records from an external system and maps them into
// the SAME normalized shapes the CSV upload path produces
// (MappedTicket / MappedCodeActivity from src/lib/ingest/mappers.ts).
// From there on, everything is shared: commit logic, idempotence,
// evidence linking, the engine. One ingestion pipeline, many sources —
// adding Linear/Asana/QuickBooks later is a fetcher + a zod schema.

import { z } from 'zod'
import type { MappedCodeActivity, MappedTicket } from '@/lib/ingest/mappers'

export type ConnectorKind = 'github' | 'jira'

export const CONNECTOR_KINDS: ConnectorKind[] = ['github', 'jira']

/** Non-secret config persisted in ConnectorSource.config (JSON string). */
export const GithubConfigSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(150),
  includePrs: z.boolean().default(true),
  /** How far back to pull commits (default 90 days). */
  days: z.number().int().min(1).max(365).default(90),
})

export const JiraConfigSchema = z.object({
  /** Cloud host, e.g. acme.atlassian.net (no scheme, no trailing slash). */
  host: z.string().trim().min(3).max(253).regex(/^[a-z0-9.-]+$/i, 'host must be a bare hostname'),
  /** JQL filter; default pulls everything the token can see. */
  jql: z.string().trim().max(2000).optional(),
})

export type GithubConfig = z.infer<typeof GithubConfigSchema>
export type JiraConfig = z.infer<typeof JiraConfigSchema>

/** Secrets — sealed with AES-256-GCM before they ever touch the DB. */
export interface GithubCredentials {
  /** Optional for public repos (unauthenticated rate limit applies). */
  token?: string
}
export interface JiraCredentials {
  /** API token (cloud). Required. */
  apiToken: string
  /** The Atlassian account email — sent as Basic-auth username. */
  email: string
}

export interface FetchSummary {
  /** Records handed to the commit layer. */
  tickets?: MappedTicket[]
  codeActivities?: MappedCodeActivity[]
  /** Upstream API calls made (for the sync summary). */
  apiCalls: number
  /** True when the upstream rate limit truncated the pull. */
  truncated: boolean
}

export class ConnectorError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ConnectorError'
    this.status = status
  }
}
