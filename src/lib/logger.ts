/**
 * Minimal structured logger.
 *
 * Why not pino/winston? Those would be over-engineered for this stage of
 * the product. This module gives:
 *   - JSON output in production (one line per entry, parseable by ELK/Datadog)
 *   - Human-friendly output in dev
 *   - A consistent shape across api/actor.ts and every route catch block
 *
 * Every entry includes a `requestId` if one was passed (or derived from
 * the request headers by the middleware). Make sure to call `setRequestId`
 * at the start of a request handler so child logs get correlated.
 */

export interface LogFields {
  [key: string]: unknown
}

let currentRequestId: string | null = null

export function setRequestId(id: string | null) {
  currentRequestId = id
}

type Level = 'debug' | 'info' | 'warn' | 'error'

const isDev = process.env.NODE_ENV !== 'production'

function emit(level: Level, msg: string, fields: LogFields = {}) {
  const entry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    requestId: currentRequestId,
    ...fields,
  }
  if (isDev) {
    // Human-friendly
    const line = `[${entry.timestamp}] ${level.toUpperCase()} ${msg}${
      Object.keys(fields).length ? ' ' + JSON.stringify(fields) : ''
    }`
    // eslint-disable-next-line no-console
    if (level === 'error') console.error(line)
    // eslint-disable-next-line no-console
    else if (level === 'warn') console.warn(line)
    // eslint-disable-next-line no-console
    else console.log(line)
  } else {
    // JSON for log aggregators
    // eslint-disable-next-line no-console
    if (level === 'error') console.error(JSON.stringify(entry))
    // eslint-disable-next-line no-console
    else if (level === 'warn') console.warn(JSON.stringify(entry))
    // eslint-disable-next-line no-console
    else console.log(JSON.stringify(entry))
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}
