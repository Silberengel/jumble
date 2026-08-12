import activityTrace from '@/lib/activity-trace'
import logger from '@/lib/logger'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { Filter } from 'nostr-tools'

let batchSeq = 0

function relayHostForPublishLog(url: string): string {
  const n = normalizeAnyRelayUrl(url) || url
  try {
    const u = new URL(n.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'))
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''
    return path ? `${u.host}${path}` : u.host
  } catch {
    return n
  }
}

function nextBatchId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++batchSeq).toString(36)}`
}

/** Compact filter for logs (avoid huge author/id arrays). */
export function compactFilterForRelayLog(f: Filter): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.kinds != null) out.kinds = f.kinds
  if (f.limit != null) out.limit = f.limit
  if (f.since != null) out.since = f.since
  if (f.until != null) out.until = f.until
  if (f.ids?.length) out.idCount = f.ids.length
  if (f.authors?.length) out.authorCount = f.authors.length
  if (f['#p']?.length) out.pTagCount = f['#p'].length
  if (f['#e']?.length) out.eTagCount = f['#e'].length
  if (f['#t']?.length) out.tTagCount = f['#t'].length
  if (typeof f.search === 'string' && f.search.length > 0) {
    out.searchPreview = f.search.length > 120 ? `${f.search.slice(0, 117)}…` : f.search
  } else if (f.search) {
    out.search = true
  }
  return out
}

export type RelayOpTerminalOutcome = 'eose' | 'closed' | 'timeout'

export interface RelayOpTerminalRow {
  cmdIndex: number
  relayUrl: string
  outcome: RelayOpTerminalOutcome
  /** Error / close / NOTICE reason */
  detail?: string
  msFromBatchStart: number
}

type GroupedRelayRow = { url: string; filters: Filter[] }

/** Short host label for subscribe REQ logs (same as publish). */
export function relayHostForSubscribeLog(url: string): string {
  return relayHostForPublishLog(url)
}

export function humanizeSubscribeTerminalDetail(outcome: RelayOpTerminalOutcome, detail?: string): string {
  const d = (detail ?? '').trim()
  if (!d) {
    if (outcome === 'eose') return 'end of stored events'
    return outcome
  }
  if (
    d === 'subscribe_close' ||
    d === 'subscription_closed' ||
    d === 'no_report_before_req_closed' ||
    d === 'batch_finalize_closed'
  ) {
    return 'REQ ended before this relay reported EOSE (often normal)'
  }
  if (d === 'batch_finalize_timeout') return 'batch closed on timeout before relay reported'
  return d.length > 100 ? `${d.slice(0, 97)}…` : d
}

/**
 * One block of text for the console (like NIP-65 retry logs), instead of expanding `terminals` / `byOutcome`.
 */
export function buildSubscribeBatchReadableSummary(rows: RelayOpTerminalRow[]): string {
  if (rows.length === 0) return '(no relay slots)'

  type Group = { outcome: RelayOpTerminalOutcome; label: string; rows: RelayOpTerminalRow[] }
  const groups: Group[] = []
  for (const r of rows) {
    const label = humanizeSubscribeTerminalDetail(r.outcome, r.detail)
    let g = groups.find((x) => x.outcome === r.outcome && x.label === label)
    if (!g) {
      g = { outcome: r.outcome, label, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }

  groups.sort((a, b) => {
    const o = a.outcome.localeCompare(b.outcome)
    if (o !== 0) return o
    return a.label.localeCompare(b.label)
  })

  const parts: string[] = []
  for (const { outcome, label, rows: list } of groups) {
    const hosts = list.map((r) => relayHostForSubscribeLog(r.relayUrl))
    const uniq = [...new Set(hosts)]
    const head =
      outcome === 'eose'
        ? `EOSE (${list.length})`
        : outcome === 'timeout'
          ? `Timeout (${list.length})`
          : `Closed (${list.length})`
    parts.push(`${head} — ${label}`)
    if (uniq.length <= 12) {
      parts.push(...uniq.map((h) => `  • ${h}`))
    } else {
      parts.push(`  • ${uniq.slice(0, 8).join(', ')} … +${uniq.length - 8} more`)
    }
  }
  return parts.join('\n')
}

function groupTerminalsByOutcome(rows: RelayOpTerminalRow[]): Record<string, { count: number; relays: string[]; cmdIndices: number[] }> {
  const map = new Map<string, { relays: string[]; cmdIndices: number[] }>()
  for (const r of rows) {
    const key = `${r.outcome}${r.detail ? `:${r.detail.slice(0, 120)}` : ''}`
    const cur = map.get(key) ?? { relays: [], cmdIndices: [] }
    cur.relays.push(r.relayUrl)
    cur.cmdIndices.push(r.cmdIndex)
    map.set(key, cur)
  }
  const out: Record<string, { count: number; relays: string[]; cmdIndices: number[] }> = {}
  for (const [k, v] of map) {
    out[k] = { count: v.relays.length, relays: v.relays, cmdIndices: v.cmdIndices }
  }
  return out
}

/**
 * Tracks one logical subscribe/query wave: one `batch_begin` and one `batch_end` with per-relay outcomes.
 */
export type RelaySubscribeOpBatchOptions = {
  /** When `quiet` is false: `info` logs batch_end at INFO; `debug` logs batch_begin/batch_end at DEBUG. */
  logLevel?: 'info' | 'debug'
  /** When true (default), skip `[RelayOp] batch_begin` / `batch_end`. Set false to opt into REQ wave logs. */
  quiet?: boolean
  /** Invoked once when this REQ wave finishes (same `rows` as `batch_end` / `terminals`). */
  onBatchEnd?: (rows: RelayOpTerminalRow[]) => void
}

/** Shape compatible with `RelayStatusDisplay` / publish feedback toasts. */
export type TimelineSubscribeRelayUiStatus = {
  url: string
  success: boolean
  error?: string
  message?: string
}

export function relayOpTerminalRowsToTimelineRelayUiStatuses(
  rows: RelayOpTerminalRow[]
): TimelineSubscribeRelayUiStatus[] {
  return rows.map((row) => {
    if (row.outcome === 'eose') {
      return {
        url: row.relayUrl,
        success: true,
        message: humanizeSubscribeTerminalDetail('eose', row.detail)
      }
    }
    if (row.outcome === 'timeout') {
      return {
        url: row.relayUrl,
        success: false,
        error: humanizeSubscribeTerminalDetail('timeout', row.detail)
      }
    }
    return {
      url: row.relayUrl,
      success: false,
      error: humanizeSubscribeTerminalDetail('closed', row.detail)
    }
  })
}

export class RelaySubscribeOpBatch {
  readonly batchId: string
  private readonly t0: number
  private readonly source: string
  private readonly grouped: GroupedRelayRow[]
  private readonly logLevel: 'info' | 'debug'
  private readonly quiet: boolean
  private readonly onBatchEnd?: (rows: RelayOpTerminalRow[]) => void
  private readonly terminal = new Map<number, RelayOpTerminalRow>()
  private endLogged = false

  constructor(source: string, grouped: GroupedRelayRow[], options?: RelaySubscribeOpBatchOptions) {
    this.batchId = nextBatchId('sub')
    this.t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.source = source
    this.grouped = grouped
    this.logLevel = options?.logLevel ?? 'debug'
    this.quiet = options?.quiet ?? true
    this.onBatchEnd = options?.onBatchEnd
  }

  private logLine(message: string, payload: Record<string, unknown>): void {
    if (this.logLevel === 'debug') {
      logger.debug(message, payload)
    } else {
      logger.info(message, payload)
    }
  }

  logBegin(): void {
    activityTrace.trace('relay', 'subscribe.batch_begin', {
      batchId: this.batchId,
      source: this.source,
      relaySlotCount: this.grouped.length
    })
    if (this.quiet) return
    const uniqueRelays = [...new Set(this.grouped.map((g) => g.url))]
    this.logLine('[RelayOp] batch_begin', {
      batchId: this.batchId,
      source: this.source,
      relaySlotCount: this.grouped.length,
      uniqueRelayCount: uniqueRelays.length,
      uniqueRelays,
      commands: this.grouped.map((g, cmdIndex) => ({
        cmdIndex,
        relay: g.url,
        filters: g.filters.map(compactFilterForRelayLog)
      }))
    })
  }

  /** Last write wins per relay index (e.g. eose then closed overwrites). */
  setTerminal(cmdIndex: number, outcome: RelayOpTerminalOutcome, detail?: string): void {
    if (cmdIndex < 0 || cmdIndex >= this.grouped.length) return
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    this.terminal.set(cmdIndex, {
      cmdIndex,
      relayUrl: this.grouped[cmdIndex]!.url,
      outcome,
      detail,
      msFromBatchStart
    })
    if (this.terminal.size >= this.grouped.length) {
      this.logEnd('complete')
    }
  }

  /**
   * When the subscription is torn down before every relay reported (or for shutdown), fill gaps and log once.
   */
  finalize(status: 'closed' | 'timeout', detail?: string): void {
    if (this.endLogged) return
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    for (let i = 0; i < this.grouped.length; i++) {
      if (!this.terminal.has(i)) {
        this.terminal.set(i, {
          cmdIndex: i,
          relayUrl: this.grouped[i]!.url,
          outcome: status === 'timeout' ? 'timeout' : 'closed',
          detail:
            status === 'timeout'
              ? (detail ?? 'batch_finalize_timeout')
              : (detail ?? 'no_report_before_req_closed'),
          msFromBatchStart
        })
      }
    }
    this.logEnd(status)
  }

  private logEnd(status: string): void {
    if (this.endLogged) return
    this.endLogged = true
    const rows = [...this.terminal.values()].sort((a, b) => a.cmdIndex - b.cmdIndex)
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    const readableSummary = buildSubscribeBatchReadableSummary(rows)
    const nEose = rows.filter((r) => r.outcome === 'eose').length
    const nTimeout = rows.filter((r) => r.outcome === 'timeout').length
    const nClosed = rows.filter((r) => r.outcome === 'closed').length
    const headline = `${rows.length} relay(s), ${elapsedMs}ms — EOSE ${nEose}, closed ${nClosed}, timeout ${nTimeout}`

    const compact: Record<string, unknown> = {
      batchId: this.batchId,
      source: this.source,
      status,
      elapsedMs,
      terminalCount: rows.length,
      eoseCount: nEose,
      closedCount: nClosed,
      timeoutCount: nTimeout
    }

    activityTrace.trace('relay', 'subscribe.batch_end', {
      batchId: this.batchId,
      source: this.source,
      status,
      elapsedMs,
      eoseCount: nEose,
      closedCount: nClosed,
      timeoutCount: nTimeout,
      relayCount: rows.length
    })

    if (!this.quiet) {
      if (this.logLevel === 'debug') {
        this.logLine('[RelayOp] batch_end', {
          ...compact,
          readableSummary,
          byOutcome: groupTerminalsByOutcome(rows),
          terminals: rows
        })
      } else {
        logger.info(`[RelayOp] batch_end — ${headline}\n${readableSummary}`, compact)
      }
    }

    this.onBatchEnd?.(rows)
  }
}

export type PublishOpResultRow = {
  cmdIndex: number
  relayUrl: string
  ok: boolean
  msFromBatchStart: number
  error?: string
}

/**
 * One publish wave to many relays: single begin/end log.
 */
export class RelayPublishOpBatch {
  readonly batchId: string
  private readonly t0: number
  private readonly source: string
  private readonly eventId: string
  private readonly relays: string[]
  private readonly results: PublishOpResultRow[] = []
  private endLogged = false

  constructor(source: string, eventId: string, relays: string[]) {
    this.batchId = nextBatchId('pub')
    this.t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.source = source
    this.eventId = eventId
    this.relays = relays
  }

  logBegin(): void {
    /* Intentionally quiet: publish outcomes surface in UI; failures are logged in logEnd. */
  }

  record(cmdIndex: number, relayUrl: string, ok: boolean, error?: string): void {
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    this.results.push({ cmdIndex, relayUrl, ok, msFromBatchStart, error })
  }

  logEnd(status: string): void {
    if (this.endLogged) return
    this.endLogged = true
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    const ok = this.results.filter((r) => r.ok)
    const fail = this.results.filter((r) => !r.ok)
    this.results.sort((a, b) => a.cmdIndex - b.cmdIndex)
    const readableSummary =
      this.relays.length === 0
        ? 'No relays targeted (empty list or skipped by session rules).'
        : fail.length === 0
          ? `All ${ok.length} relay(s) accepted the publish.`
          : [
            `${fail.length} relay(s) failed:`,
            ...fail.map(
              (r) =>
                `  • ${relayHostForPublishLog(r.relayUrl)} — ${(r.error && String(r.error).trim()) || 'rejected or error'}`
            ),
            ok.length > 0 ? `${ok.length} relay(s) OK: ${ok.map((r) => relayHostForPublishLog(r.relayUrl)).join(', ')}` : ''
          ]
            .filter(Boolean)
            .join('\n')
    if (this.relays.length === 0 && status === 'no_targets') {
      logger.warn('[RelayOp] publish_batch_end — no relay targets', {
        batchId: this.batchId,
        source: this.source,
        eventId: this.eventId,
        status
      })
      return
    }
    if (fail.length > 0) {
      logger.warn(`[RelayOp] publish_batch_end — ${readableSummary}`, {
        batchId: this.batchId,
        source: this.source,
        eventId: this.eventId,
        status,
        elapsedMs,
        okCount: ok.length,
        failCount: fail.length
      })
    }
  }
}
