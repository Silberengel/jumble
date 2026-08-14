import { Button } from '@/components/ui/button'
import { LIBRARY_RELAY_URLS } from '@/constants'
import { getNoteBech32Id } from '@/lib/event'
import {
  queryIndexRelayPublicationExport,
  queryIndexRelayPublicationMeta,
  type IndexRelayPublicationMeta
} from '@/lib/index-relay-http'
import { persistLibraryPublicationForReading } from '@/lib/library-publication-index'
import { markPublicationReadingStarted } from '@/lib/library-publication-reading-session'
import {
  exportPublicationDownload,
  exportPublicationFromMercuryEvents,
  type PublicationDownloadFormat
} from '@/lib/publication-export'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MERCURY_HTTP_BASES = LIBRARY_RELAY_URLS.filter((u) => /^https?:\/\//i.test(u))

export type PublicationOverviewAction =
  | 'interactions'
  | 'peruse'
  | 'save'
  | 'epub'

function publicationNaddr(event: Event): string | null {
  try {
    const id = getNoteBech32Id(event)
    return id.startsWith('naddr1') ? id : null
  } catch {
    return null
  }
}

function streamItemToEvent(item: { event?: Record<string, unknown> | null }): Event | null {
  const raw = item.event
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const pubkey = typeof raw.pubkey === 'string' ? raw.pubkey : ''
  const kind = typeof raw.kind === 'number' ? raw.kind : -1
  const created_at = typeof raw.created_at === 'number' ? raw.created_at : 0
  const content = typeof raw.content === 'string' ? raw.content : ''
  const sig = typeof raw.sig === 'string' ? raw.sig : ''
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[][]) : []
  if (!id || !pubkey || kind < 0 || !sig) return null
  return { id, pubkey, kind, created_at, content, sig, tags } as Event
}

/**
 * Overview control: select + Go. Default is interactions (no publication body fetch).
 * Peruse / Save / EPUB only when `readable`.
 */
export default function PublicationOverviewActions({
  event,
  onPeruse,
  className
}: {
  event: Event
  onPeruse: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState<PublicationOverviewAction>('interactions')
  const [meta, setMeta] = useState<IndexRelayPublicationMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const naddr = useMemo(() => publicationNaddr(event), [event])

  useEffect(() => {
    let cancelled = false
    setMeta(null)
    setError(null)
    if (!naddr) return
    void (async () => {
      for (const base of MERCURY_HTTP_BASES) {
        try {
          const row = await queryIndexRelayPublicationMeta(base, naddr)
          if (cancelled) return
          if (row) {
            setMeta(row)
            return
          }
        } catch {
          // try next base
        }
      }
      const hasContentRef = event.tags.some(
        (tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1].startsWith('30041:')
      )
      if (!cancelled) {
        setMeta({
          readable: hasContentRef,
          event_count: 0,
          index_count: 0,
          content_count: hasContentRef ? 1 : 0
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [naddr, event.tags])

  const readable = Boolean(meta?.readable)

  useEffect(() => {
    if (!readable && action !== 'interactions') {
      setAction('interactions')
    }
  }, [readable, action])

  const runExport = useCallback(
    async (format: 'save' | PublicationDownloadFormat) => {
      if (!naddr) throw new Error('Missing naddr')
      let items: Awaited<ReturnType<typeof queryIndexRelayPublicationExport>>['items'] = []
      let eventCount = 0
      for (const base of MERCURY_HTTP_BASES) {
        try {
          const page = await queryIndexRelayPublicationExport(base, naddr)
          if (page.items.length > 0) {
            items = page.items
            eventCount = page.meta.event_count || page.items.length
            break
          }
        } catch {
          // try next
        }
      }
      if (items.length === 0) {
        throw new Error('Mercury export unavailable')
      }
      if (eventCount > 5_000) {
        console.warn('[Publication] large export', { eventCount, naddr })
      }
      const nested = items
        .map(streamItemToEvent)
        .filter((ev): ev is Event => Boolean(ev))
      if (format === 'save') {
        await indexedDb.putPublicationWithNestedEvents(event, nested)
        persistLibraryPublicationForReading(event)
        setSaved(true)
        return
      }
      await exportPublicationFromMercuryEvents(event, nested, format)
    },
    [event, naddr]
  )

  const onGo = useCallback(async () => {
    setError(null)
    if (action === 'interactions') return
    if (!readable) return
    setBusy(true)
    try {
      if (action === 'peruse') {
        markPublicationReadingStarted(event)
        onPeruse()
        return
      }
      if (action === 'save') {
        if (saved) return
        try {
          await runExport('save')
        } catch {
          persistLibraryPublicationForReading(event)
          setSaved(true)
        }
        return
      }
      if (action === 'epub') {
        try {
          await runExport('epub')
        } catch {
          await exportPublicationDownload(event, 'epub', LIBRARY_RELAY_URLS)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [action, event, onPeruse, readable, runExport, saved])

  return (
    <div className={className}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm"
          value={action}
          disabled={busy}
          onChange={(e) => setAction(e.target.value as PublicationOverviewAction)}
          aria-label={t('Publication action')}
        >
          <option value="interactions">{t('See the interactions')}</option>
          {readable ? (
            <>
              <option value="peruse">{t('Peruse the publication')}</option>
              <option value="save">
                {saved ? t('Saved — remove') : t('Save for offline reading')}
              </option>
              <option value="epub">{t('Download as EPUB')}</option>
            </>
          ) : null}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={busy || action === 'interactions'}
          onClick={() => void onGo()}
          aria-label={t('Go')}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      {!readable && meta ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('This catalog card has no nested reading content.')}
        </p>
      ) : null}
    </div>
  )
}
