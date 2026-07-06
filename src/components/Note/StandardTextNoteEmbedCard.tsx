import type { MouseEventHandler, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import NormalContentPreview from '@/components/ContentPreview/NormalContentPreview'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { getNoteBech32Id, isReplaceableEvent } from '@/lib/event'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { preloadNotePageChunk } from '@/pages/secondary/NotePage/NotePageRoute'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'

/**
 * Compact, consistent card for kind-1 (and text-like) embedded / quoted notes.
 * Used in feed embeds, stringified repost targets, and notification context previews.
 */
export default function StandardTextNoteEmbedCard({
  event,
  className,
  lineClampClassName = 'line-clamp-4',
  deferAuthorAvatar = false,
  header,
  originalNoteId,
  onCardClick
}: {
  event: Event
  className?: string
  lineClampClassName?: string
  deferAuthorAvatar?: boolean
  /** Optional row above the author (e.g. boost label). */
  header?: ReactNode
  /** Pointer from embed fetch (nevent / naddr / hex); used for navigation URL. */
  originalNoteId?: string
  /** When set, called instead of default note-panel navigation (e.g. parent preview wrapper). */
  onCardClick?: MouseEventHandler<HTMLDivElement>
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const [copied, setCopied] = useState(false)

  const noteBech32Id = useMemo(() => getNoteBech32Id(event), [event])
  const copyLabel = isReplaceableEvent(event.kind) ? t('Copy naddr') : t('Copy nevent')

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(noteBech32Id)
        setCopied(true)
        toast.success(t('Copied to clipboard'))
        setTimeout(() => setCopied(false), 2000)
      } catch {
        toast.error(t('Failed to copy'))
      }
    },
    [noteBech32Id, t]
  )

  const handleCardClick: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const target = e.target as HTMLElement
      if (
        target.closest('button') ||
        target.closest('[role="button"]') ||
        target.closest('a') ||
        target.closest('[data-user-avatar]') ||
        target.closest('[data-username]')
      ) {
        return
      }
      if (window.getSelection()?.toString().trim()) return

      e.stopPropagation()
      client.addEventToCache(event)

      if (onCardClick) {
        onCardClick(e)
        return
      }

      const noteUrl = toNote(
        originalNoteId ?? event,
        typeof originalNoteId === 'string' && /^[0-9a-f]{64}$/i.test(originalNoteId.trim())
          ? event
          : undefined
      )
      navigateToNote(noteUrl, event, getCachedThreadContextEvents(event))
    },
    [event, navigateToNote, onCardClick, originalNoteId]
  )

  return (
    <div
      data-embedded-note
      className={cn(
        'not-prose clickable relative rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm transition-colors hover:bg-accent/30',
        className
      )}
      onPointerEnter={preloadNotePageChunk}
      onClick={handleCardClick}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 z-10 h-7 w-7 text-muted-foreground hover:text-foreground"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      {header ? <div className="mb-2 min-w-0 pr-8">{header}</div> : null}
      <div className="flex min-w-0 gap-2 pr-8">
        <UserAvatar
          userId={event.pubkey}
          size="tiny"
          className="mt-0.5 shrink-0"
          deferRemoteAvatar={deferAuthorAvatar}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <Username
            userId={event.pubkey}
            className="min-w-0 truncate text-sm font-semibold leading-tight"
            skeletonClassName="h-4"
          />
          <NormalContentPreview event={event} className={cn('text-sm text-foreground/95', lineClampClassName)} />
        </div>
      </div>
    </div>
  )
}
