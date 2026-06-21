/**
 * Opt-in activity tracer for diagnosing background noise and main-thread churn.
 *
 * Browser console (dev):
 *   imwaldTrace.enable()              — sampled logs + 5s counter summary
 *   imwaldTrace.enable({ verbose: true, debug: true })  — firehose + logger debug
 *   imwaldTrace.summary()             — print counters now
 *   imwaldTrace.recent(40)            — last N events
 *   imwaldTrace.relaySources(15)      — top relay call sites (by source tag)
 *   imwaldTrace.disable()
 *
 * Persist: localStorage.setItem('imwald-trace', 'true') then reload.
 */

import { appendConsoleLogEntry, withConsoleCaptureSuppressed } from '@/lib/console-log-buffer'
import logger from '@/lib/logger'

export type ActivityCategory =
  | 'render'
  | 'effect'
  | 'state'
  | 'provider'
  | 'relay'
  | 'publish'
  | 'ingest'
  | 'stats'
  | 'poll'
  | 'cache'
  | 'api'
  | 'editor'

export type ActivityTraceOptions = {
  /** Log every event (default: sample high-frequency categories). */
  verbose?: boolean
  /** Also enable {@link logger.setDebugMode}. */
  debug?: boolean
  /** Periodic counter dump (default 5000ms). 0 disables. */
  summaryIntervalMs?: number
  /** Min ms between per-component render logs (default 400). */
  renderSampleMs?: number
}

type TraceEntry = {
  at: number
  category: ActivityCategory
  event: string
  detail?: unknown
}

const CATEGORY_STYLE: Record<ActivityCategory, string> = {
  render: 'color:#7dd3fc',
  effect: 'color:#a5b4fc',
  state: 'color:#fbbf24',
  provider: 'color:#c4b5fd',
  relay: 'color:#34d399',
  publish: 'color:#fb923c',
  ingest: 'color:#f472b6',
  stats: 'color:#2dd4bf',
  poll: 'color:#a3e635',
  cache: 'color:#94a3b8',
  api: 'color:#38bdf8',
  editor: 'color:#fcd34d'
}

const HIGH_FREQUENCY: ReadonlySet<ActivityCategory> = new Set([
  'render',
  'state',
  'stats',
  'ingest',
  'editor'
])

class ActivityTraceService {
  private enabled = false
  private verbose = false
  private renderSampleMs = 400
  private bootAt = performance.now()
  private counters = new Map<string, number>()
  /** Relay `source` tags from query/subscribe traces (e.g. `SpellsPage.followSetCatalog`). */
  private relaySourceCounters = new Map<string, number>()
  private recentEntries: TraceEntry[] = []
  private readonly recentMax = 200
  private lastRenderLogAt = new Map<string, number>()
  private summaryTimer: ReturnType<typeof setInterval> | null = null
  private summaryIntervalMs = 5000
  private readonly enabledListeners = new Set<() => void>()

  constructor() {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('imwald-trace') === 'true') {
      this.enable({ debug: localStorage.getItem('imwald-debug') === 'true' })
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isVerbose(): boolean {
    return this.verbose
  }

  subscribeEnabled(listener: () => void): () => void {
    this.enabledListeners.add(listener)
    return () => this.enabledListeners.delete(listener)
  }

  private notifyEnabledChanged(): void {
    for (const listener of this.enabledListeners) {
      listener()
    }
  }

  private emitLog(
    message: string,
    options?: { style?: string; detail?: unknown; type?: string }
  ): void {
    const type = options?.type ?? 'trace'
    let fullMessage = message
    if (options?.detail !== undefined) {
      const detailText =
        typeof options.detail === 'object'
          ? JSON.stringify(options.detail)
          : String(options.detail)
      fullMessage = `${message} ${detailText}`
    }
    const formattedParts = options?.style
      ? [{ text: fullMessage, style: options.style }]
      : [{ text: fullMessage }]
    appendConsoleLogEntry({ type, message: fullMessage, formattedParts })
    withConsoleCaptureSuppressed(() => {
      if (options?.style) {
        if (options.detail !== undefined) {
          console.log(`%c${message}`, options.style, options.detail)
        } else {
          console.log(`%c${message}`, options.style)
        }
      } else if (options?.detail !== undefined) {
        console.log(message, options.detail)
      } else {
        console.log(message)
      }
    })
  }

  enable(options: ActivityTraceOptions = {}): void {
    this.enabled = true
    this.verbose = options.verbose ?? false
    this.renderSampleMs = options.renderSampleMs ?? 400
    this.summaryIntervalMs = options.summaryIntervalMs ?? 5000
    localStorage.setItem('imwald-trace', 'true')
    if (options.debug) {
      logger.setDebugMode(true)
    }
    this.restartSummaryTimer()
    this.notifyEnabledChanged()
    this.emitLog(
      `[ActivityTrace] enabled (${this.verbose ? 'verbose' : 'sampled'})`,
      { style: 'color:#4ade80;font-weight:bold', type: 'info' }
    )
    this.trace('state', 'trace.enabled', { verbose: this.verbose, debug: options.debug ?? false })
  }

  disable(): void {
    this.enabled = false
    this.verbose = false
    localStorage.setItem('imwald-trace', 'false')
    this.stopSummaryTimer()
    this.notifyEnabledChanged()
    this.emitLog('[ActivityTrace] disabled', {
      style: 'color:#f87171;font-weight:bold',
      type: 'info'
    })
  }

  reset(): void {
    this.counters.clear()
    this.relaySourceCounters.clear()
    this.recentEntries = []
    this.lastRenderLogAt.clear()
  }

  /** Elapsed ms since tracer boot / page load hook. */
  sinceBoot(): number {
    return Math.round(performance.now() - this.bootAt)
  }

  bump(category: ActivityCategory, event: string, amount = 1): void {
    if (!this.enabled) return
    const key = `${category}:${event}`
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount)
  }

  /** Count relay operations by caller `source` tag (shown in summary). */
  bumpRelaySource(source: string, amount = 1): void {
    if (!this.enabled || !source) return
    this.relaySourceCounters.set(source, (this.relaySourceCounters.get(source) ?? 0) + amount)
  }

  trace(category: ActivityCategory, event: string, detail?: unknown): void {
    if (!this.enabled) return

    this.bump(category, event)
    if (category === 'relay' && detail && typeof detail === 'object' && detail !== null) {
      const src = (detail as { source?: unknown }).source
      if (typeof src === 'string' && src.length > 0) {
        this.bumpRelaySource(src)
      }
    }

    const shouldLog =
      this.verbose ||
      !HIGH_FREQUENCY.has(category) ||
      category === 'render'
        ? this.shouldLogRender(event)
        : this.shouldLogSampled(category, event)

    const entry: TraceEntry = { at: performance.now(), category, event, detail }
    this.recentEntries.push(entry)
    if (this.recentEntries.length > this.recentMax) {
      this.recentEntries.splice(0, this.recentEntries.length - this.recentMax)
    }

    if (!shouldLog) return

    const style = CATEGORY_STYLE[category] ?? 'color:#e2e8f0'
    const prefix = `[Trace +${this.sinceBoot()}ms ${category}] ${event}`
    this.emitLog(prefix, { style, detail, type: 'trace' })
  }

  /** High-frequency render: log at most once per component per renderSampleMs unless verbose. */
  markRender(component: string, detail?: Record<string, unknown>): void {
    if (!this.enabled) return
    this.bump('render', component)
    if (this.verbose || this.shouldLogRender(component)) {
      this.trace('render', component, detail)
    }
  }

  summary(force = false): void {
    if (!this.enabled && !force) return
    const rows: { category: string; event: string; count: number }[] = []
    for (const [key, count] of [...this.counters.entries()].sort((a, b) => b[1] - a[1])) {
      const sep = key.indexOf(':')
      rows.push({
        category: sep >= 0 ? key.slice(0, sep) : key,
        event: sep >= 0 ? key.slice(sep + 1) : key,
        count
      })
    }
    const top = rows.slice(0, 40)
    const relaySources = [...this.relaySourceCounters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
    const headline = `[ActivityTrace] summary +${this.sinceBoot()}ms (${rows.length} keys, top ${top.length})`
    const bodyParts: string[] = []
    if (top.length > 0) {
      bodyParts.push(top.map((r) => `  ${r.category}:${r.event} ×${r.count}`).join('\n'))
    } else {
      bodyParts.push('  (no events yet)')
    }
    if (relaySources.length > 0) {
      bodyParts.push(
        '  relay sources:',
        ...relaySources.map(([src, count]) => `    ${src} ×${count}`)
      )
    }
    const body = bodyParts.join('\n')
    this.emitLog(`${headline}\n${body}`, {
      style: 'color:#4ade80;font-weight:bold',
      type: 'trace'
    })
    withConsoleCaptureSuppressed(() => {
      console.groupCollapsed(`%c${headline}`, 'color:#4ade80;font-weight:bold')
      if (top.length > 0) {
        console.table(top)
      } else {
        console.log('(no events yet)')
      }
      if (relaySources.length > 0) {
        console.log('relay sources (top):')
        console.table(relaySources.map(([source, count]) => ({ source, count })))
      }
      console.groupEnd()
    })
  }

  /** Print relay operation counts grouped by caller `source` tag. */
  relaySources(limit = 20): { source: string; count: number }[] {
    const rows = [...this.relaySourceCounters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([source, count]) => ({ source, count }))
    console.table(rows)
    return rows
  }

  recent(limit = 30): TraceEntry[] {
    const slice = this.recentEntries.slice(-limit)
    console.table(
      slice.map((e) => ({
        ms: Math.round(e.at - this.bootAt),
        category: e.category,
        event: e.event,
        detail: e.detail ?? ''
      }))
    )
    return slice
  }

  private shouldLogRender(component: string): boolean {
    const now = performance.now()
    const last = this.lastRenderLogAt.get(component) ?? 0
    if (now - last < this.renderSampleMs) return false
    this.lastRenderLogAt.set(component, now)
    return true
  }

  private shouldLogSampled(category: ActivityCategory, event: string): boolean {
    const key = `${category}:${event}`
    const count = this.counters.get(key) ?? 0
    // Log 1st, 10th, 100th, then every 500th for noisy streams.
    if (count <= 1) return true
    if (count === 10 || count === 100) return true
    return count % 500 === 0
  }

  private restartSummaryTimer(): void {
    this.stopSummaryTimer()
    if (this.summaryIntervalMs <= 0) return
    this.summaryTimer = setInterval(() => this.summary(), this.summaryIntervalMs)
  }

  private stopSummaryTimer(): void {
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer)
      this.summaryTimer = null
    }
  }
}

const activityTrace = new ActivityTraceService()

if (import.meta.env.DEV) {
  ;(window as unknown as { imwaldTrace: ActivityTraceService }).imwaldTrace = activityTrace
}

export default activityTrace
