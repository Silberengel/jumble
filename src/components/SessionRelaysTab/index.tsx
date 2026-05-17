import client from '@/services/client.service'
import relayInfoService from '@/services/relay-info.service'
import {
  isRelayStrikeEntryActive,
  type RelayStrikeDebugSnapshot
} from '@/lib/relay-strikes'
import { isHttpRelayUrl } from '@/lib/url'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle2, Zap, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TRelayInfo } from '@/types'
import { useNostr } from '@/providers/NostrProvider'

type SessionDebug = {
  scoredRelays: { url: string; successCount: number; avgLatencyMs: number }[]
  presetWorking: string[]
  relayStrikes: RelayStrikeDebugSnapshot
}

type StrikeEntry = RelayStrikeDebugSnapshot['entries'][number]['entry']

function loadDebug(): SessionDebug {
  return client.getSessionRelayDebug()
}

function formatSkipUntil(ts: number, now: number): string | null {
  if (ts <= now) return null
  const sec = Math.ceil((ts - now) / 1000)
  if (sec < 90) return `${sec}s`
  if (sec < 7200) return `${Math.ceil(sec / 60)}m`
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function strikeStatusChips(
  entry: StrikeEntry,
  cacheRelay: boolean,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string[] {
  const chips: string[] = []
  if (cacheRelay) chips.push(t('Session relay strike cache relay'))
  if (now < entry.readStrikeSkipUntil) chips.push(t('Session relay strike read skipped'))
  if (now < entry.publishStrikeSkipUntil) chips.push(t('Session relay strike publish skipped'))
  if (now < entry.rateLimitUntil) chips.push(t('Session relay strike rate limited'))
  if (now < entry.slowParkUntil) chips.push(t('Session relay strike slow parked'))
  return chips
}

function strikeDetailLines(
  entry: StrikeEntry,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string[] {
  const lines: string[] = []
  if (entry.readFailures > 0) {
    lines.push(t('Session relay strike read failures', { count: entry.readFailures }))
  }
  if (entry.publishFailures > 0) {
    lines.push(t('Session relay strike publish failures', { count: entry.publishFailures }))
  }
  if (entry.slowSignals > 0) {
    lines.push(t('Session relay strike slow signals', { count: entry.slowSignals }))
  }
  for (const [ts, label] of [
    [entry.readStrikeSkipUntil, t('Session relay strike read skipped')],
    [entry.publishStrikeSkipUntil, t('Session relay strike publish skipped')],
    [entry.rateLimitUntil, t('Session relay strike rate limited')],
    [entry.slowParkUntil, t('Session relay strike slow parked')]
  ] as const) {
    const until = formatSkipUntil(ts, now)
    if (until) lines.push(`${label} ${t('Session relay strike until', { time: until })}`)
  }
  return lines
}

export default function SessionRelaysTab() {
  const { t } = useTranslation()
  const { httpRelayListEvent } = useNostr()
  const [debug, setDebug] = useState<SessionDebug | null>(null)
  const [relayInfoByUrl, setRelayInfoByUrl] = useState<Record<string, TRelayInfo | undefined>>({})
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(() => {
    setDebug(loadDebug())
    setNow(Date.now())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const activeStrikes = useMemo(() => {
    if (!debug) return []
    return debug.relayStrikes.entries.filter(({ entry }) => isRelayStrikeEntryActive(entry, now))
  }, [debug, now])

  useEffect(() => {
    if (debug === null) return
    const urls = Array.from(
      new Set([
        ...debug.presetWorking,
        ...debug.scoredRelays.map((r) => r.url),
        ...activeStrikes.map((s) => s.key)
      ])
    )
    if (urls.length === 0) return
    let cancelled = false
    void relayInfoService.getRelayInfos(urls).then((infos) => {
      if (cancelled) return
      const next: Record<string, TRelayInfo | undefined> = {}
      infos.forEach((info, idx) => {
        next[urls[idx]!] = info
      })
      setRelayInfoByUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [debug, activeStrikes])

  const formatRelayAddress = (url: string) => {
    try {
      const u = new URL(url)
      return u.host || url
    } catch {
      return url
    }
  }

  const formatRelayLabel = (url: string) => {
    const name = relayInfoByUrl[url]?.name?.trim()
    if (name) return name
    return formatRelayAddress(url)
  }

  const configuredHttpRelayAddresses = useMemo(() => {
    const out = new Set<string>()
    if (!httpRelayListEvent) return out
    for (const tag of httpRelayListEvent.tags) {
      if (tag[0] !== 'r' || !tag[1]) continue
      const raw = tag[1].trim()
      if (!isHttpRelayUrl(raw)) continue
      out.add(formatRelayAddress(raw).toLowerCase())
    }
    return out
  }, [httpRelayListEvent])

  const isHttpRelayEntry = (url: string): boolean => {
    if (isHttpRelayUrl(url)) return true
    const infoUrl = relayInfoByUrl[url]?.url
    if (infoUrl && isHttpRelayUrl(infoUrl)) return true
    return configuredHttpRelayAddresses.has(formatRelayAddress(url).toLowerCase())
  }

  const freeRelay = useCallback(
    (key: string) => {
      client.clearSessionRelayStrike(key)
      refresh()
    },
    [refresh]
  )

  if (debug === null) return null

  const RelayNameWithTransport = ({ url, mono = true }: { url: string; mono?: boolean }) => (
    <span className="min-w-0 inline-flex max-w-full items-center gap-1.5">
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''}`} title={url}>
        {formatRelayLabel(url)}
      </span>
      {isHttpRelayEntry(url) ? (
        <span className="shrink-0 rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
          HTTP
        </span>
      ) : null}
    </span>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{t('Session relays tab description')}</p>
        <Button variant="outline" size="sm" onClick={refresh} className="shrink-0">
          <RefreshCw className="h-4 w-4 mr-1" />
          {t('Refresh')}
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
          {t('Session relays preset working')}
        </h3>
        <p className="text-muted-foreground text-xs">{t('Session relays preset working hint')}</p>
        <ul className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm font-mono">
          {debug.presetWorking.length === 0 ? (
            <li className="text-muted-foreground">{t('None')}</li>
          ) : (
            debug.presetWorking.map((url) => (
              <li key={url} className="truncate">
                <RelayNameWithTransport url={url} />
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          {t('Session relays scored random')}
        </h3>
        <p className="text-muted-foreground text-xs">{t('Session relays scored random hint')}</p>
        <ul className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          {debug.scoredRelays.length === 0 ? (
            <li className="text-muted-foreground">{t('None')}</li>
          ) : (
            debug.scoredRelays.map(({ url, successCount, avgLatencyMs }) => (
              <li key={url} className="flex justify-between items-center gap-2 font-mono">
                <RelayNameWithTransport url={url} />
                <span className="shrink-0 text-muted-foreground text-xs">
                  {successCount} {t('successes')} · ~{avgLatencyMs} ms
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          {t('Session relay strikes')}
        </h3>
        <p className="text-muted-foreground text-xs">{t('Session relay strikes hint')}</p>
        {debug.relayStrikes.cacheRelayKeys.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{t('Cache relay keys')}:</span>{' '}
            <span className="font-mono break-all">
              {debug.relayStrikes.cacheRelayKeys.join(', ')}
            </span>
          </p>
        ) : null}
        <ul className="rounded-lg border bg-muted/30 divide-y divide-border text-sm">
          {activeStrikes.length === 0 ? (
            <li className="p-3 text-muted-foreground">{t('Session relay strikes none active')}</li>
          ) : (
            activeStrikes.map(({ key, entry, cacheRelay }) => {
              const chips = strikeStatusChips(entry, cacheRelay, now, t)
              const details = strikeDetailLines(entry, now, t)
              return (
                <li key={key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <RelayNameWithTransport url={key} />
                    {chips.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {details.length > 0 ? (
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {details.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-end sm:self-start"
                    onClick={() => freeRelay(key)}
                  >
                    {t('Session relay strike free')}
                  </Button>
                </li>
              )
            })
          )}
        </ul>
      </section>
    </div>
  )
}
