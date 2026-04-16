import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SimpleUsername } from '@/components/Username'
import { getNoteBech32Id } from '@/lib/event'
import { CITATION_PICKER_KINDS, searchCitationEventsForPicker } from '@/services/mention-event-search.service'
import client from '@/services/client.service'
import { Search } from 'lucide-react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Matches {@link MarkdownArticle} / AsciiDoc citation token `[[citation::type::…]]`. */
export type LabCitationDisplayType =
  | 'end'
  | 'foot'
  | 'foot-end'
  | 'inline'
  | 'quote'
  | 'prompt-end'
  | 'prompt-inline'

export function buildCitationWikiMacro(displayType: LabCitationDisplayType, nostrLink: string): string {
  let id = nostrLink.trim()
  if (id.toLowerCase().startsWith('nostr:')) id = id.slice(6)
  return `[[citation::${displayType}::${id}]]`
}

function isCitationKind(kind: number): boolean {
  return (CITATION_PICKER_KINDS as readonly number[]).includes(kind)
}

export function AdvancedLabCitationPickerDialog({
  open,
  onOpenChange,
  displayType,
  onInsertMacro
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  displayType: LabCitationDisplayType
  onInsertMacro: (macro: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setDebouncedQuery('')
    setEvents([])
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [open, query])

  useEffect(() => {
    if (!open || !debouncedQuery) {
      setEvents([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void searchCitationEventsForPicker(debouncedQuery, 20)
      .then((list) => {
        if (cancelled) return
        setEvents(list.filter((ev) => isCitationKind(ev.kind)).slice(0, 15))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, debouncedQuery])

  const handleSelect = useCallback(
    (event: NostrEvent) => {
      if (!isCitationKind(event.kind)) return
      client.addEventToCache(event)
      try {
        const bech32 = getNoteBech32Id(event)
        const link = `nostr:${bech32}`
        onInsertMacro(buildCitationWikiMacro(displayType, link))
        onOpenChange(false)
      } catch {
        onInsertMacro(buildCitationWikiMacro(displayType, `nostr:${nip19.noteEncode(event.id)}`))
        onOpenChange(false)
      }
    },
    [displayType, onInsertMacro, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col gap-4 z-[280]"
        overlayClassName="z-[275]"
      >
        <DialogHeader>
          <DialogTitle>{t('Advanced lab citation dialog title')}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t('Advanced lab citation dialog hint')}</p>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('Advanced lab citation search placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="min-h-[200px] max-h-[50vh] border rounded-md overflow-y-auto overflow-x-hidden">
          <div className="p-2 space-y-1">
            {loading && (
              <div className="space-y-2 p-2" role="status" aria-busy="true" aria-live="polite">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            )}
            {!loading && debouncedQuery && events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">{t('Advanced lab citation none')}</p>
            )}
            {!loading &&
              events.map((ev) => (
                <Button
                  key={ev.id}
                  variant="ghost"
                  className="w-full justify-start text-left h-auto py-2 px-3 font-normal"
                  onClick={() => handleSelect(ev)}
                >
                  <div className="flex flex-col gap-0.5 min-w-0 w-full">
                    <span className="text-xs text-muted-foreground">
                      {t('Advanced lab citation kindLabel', { kind: ev.kind })}
                    </span>
                    <SimpleUsername userId={ev.pubkey} className="text-xs text-muted-foreground truncate" />
                    <span className="text-sm line-clamp-2 break-words">{ev.content || t('(empty)')}</span>
                  </div>
                </Button>
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
