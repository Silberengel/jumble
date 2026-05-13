import client from '@/services/client.service'
import relayInfoService from '@/services/relay-info.service'
import type { RelayStrikeDebugSnapshot } from '@/lib/relay-strikes'
import { isHttpRelayUrl } from '@/lib/url'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TRelayInfo } from '@/types'
import { useNostr } from '@/providers/NostrProvider'

type SessionDebug = {
  scoredRelays: { url: string; successCount: number; avgLatencyMs: number }[]
  presetWorking: string[]
  relayStrikes: RelayStrikeDebugSnapshot
}

function loadDebug(): SessionDebug {
  return client.getSessionRelayDebug()
}

export default function SessionRelaysTab() {
  const { t } = useTranslation()
  const { httpRelayListEvent } = useNostr()
  const [debug, setDebug] = useState<SessionDebug | null>(null)
  const [relayInfoByUrl, setRelayInfoByUrl] = useState<Record<string, TRelayInfo | undefined>>({})

  const refresh = useCallback(() => {
    setDebug(loadDebug())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (debug === null) return
    const urls = Array.from(
      new Set([
        ...debug.presetWorking,
        ...debug.scoredRelays.map((r) => r.url)
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
  }, [debug])

  const formatRelayAddress = (url: string) => {
    try {
      const u = new URL(url)
      return u.host || url // host keeps explicit port when present
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
        <p className="text-muted-foreground text-sm">
          {t('Session relays tab description')}
        </p>
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
        <p className="text-muted-foreground text-xs">
          {t('Session relays preset working hint')}
        </p>
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
        <p className="text-muted-foreground text-xs">
          {t('Session relays scored random hint')}
        </p>
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
        <h3 className="text-sm font-medium">{t('Session relay strikes', { defaultValue: 'Session relay strikes' })}</h3>
        <p className="text-muted-foreground text-xs">
          {t('Session relay strikes hint', {
            defaultValue:
              'Session-only: failed reads/publishes accrue strikes; five failures skip a relay for three minutes. Rate-limit NOTICEs apply a ten-minute cooldown without strikes. Cache relays (kind 10432) always count failures even during cooldown.'
          })}
        </p>
        <p className="text-xs text-muted-foreground font-mono break-all">
          {t('Cache relay keys', { defaultValue: 'Cache relay keys' })}:{' '}
          {debug.relayStrikes.cacheRelayKeys.length === 0
            ? t('None')
            : debug.relayStrikes.cacheRelayKeys.join(', ')}
        </p>
        <pre className="rounded-lg border bg-muted/30 p-3 text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {debug.relayStrikes.entries.length === 0
            ? t('None')
            : JSON.stringify(debug.relayStrikes.entries, null, 2)}
        </pre>
      </section>

    </div>
  )
}
