import ContentPreview from '@/components/ContentPreview'
import UserAvatar from '@/components/UserAvatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import {
  getParentBech32Id,
  getParentEventHexId,
  getRootBech32Id,
  getRootEventHexId
} from '@/lib/event'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { resolveNoteEventSync } from '@/lib/resolve-note-event-sync'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

function peekThreadContextEvent(bech32OrHex: string | undefined): Event | undefined {
  if (!bech32OrHex?.trim()) return undefined
  return client.peekSessionCachedEvent(bech32OrHex.trim())
}

function ThreadContextPreview({ event }: { event: Event }) {
  return (
    <div className="mb-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2 opacity-90">
      <div className="flex items-center gap-2">
        <UserAvatar userId={event.pubkey} size="small" className="shrink-0" deferRemoteAvatar={false} />
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          <ContentPreview event={event} />
        </div>
      </div>
    </div>
  )
}

/**
 * Shown while the lazy NotePage chunk loads. Renders the clicked note from the navigation/session
 * cache when available so the secondary panel is not blank.
 */
export default function NotePageInstantShell({
  id,
  index,
  hideTitlebar = false,
  initialEvent
}: {
  id?: string
  index?: number
  hideTitlebar?: boolean
  initialEvent?: Event
}) {
  const { t } = useTranslation()
  const event = resolveNoteEventSync(id, initialEvent)

  if (!event) {
    return (
      <SecondaryPageLayout
        index={index}
        title={hideTitlebar ? undefined : t('Note')}
      >
        <div className="px-4 pt-3">
          <div className="flex items-center space-x-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 w-0">
              <div className="py-1">
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="py-0.5">
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
          <div className="pt-2">
            <div className="my-1">
              <Skeleton className="my-1 mt-2 h-4 w-full" />
            </div>
            <div className="my-1">
              <Skeleton className="my-1 h-4 w-2/3" />
            </div>
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }

  const cachedContext = getCachedThreadContextEvents(event)
  const parentBech32 = getParentBech32Id(event)
  const rootBech32 = getRootBech32Id(event)
  const parentHex = getParentEventHexId(event)?.toLowerCase()
  const rootHex = getRootEventHexId(event)?.toLowerCase()
  const selfHex = event.id.toLowerCase()

  const parentEvent =
    cachedContext.find((e) => parentHex && e.id.toLowerCase() === parentHex) ??
    peekThreadContextEvent(parentBech32)
  const rootEvent =
    cachedContext.find((e) => rootHex && e.id.toLowerCase() === rootHex) ??
    peekThreadContextEvent(rootBech32)

  const parentEventForStrip =
    parentEvent && parentEvent.id.toLowerCase() !== selfHex ? parentEvent : undefined
  const rootEventForStrip =
    rootEvent && rootEvent.id.toLowerCase() !== selfHex ? rootEvent : undefined

  return (
    <SecondaryPageLayout index={index} title={hideTitlebar ? undefined : t('Note')}>
      <div className="w-full px-4 pt-3">
        {rootEventForStrip && parentEventForStrip?.id !== rootEventForStrip.id && (
          <ThreadContextPreview event={rootEventForStrip} />
        )}
        {parentEventForStrip && (
          <>
            <ThreadContextPreview event={parentEventForStrip} />
            <div className="ml-5 h-3 w-px bg-border" />
          </>
        )}
        {(rootEventForStrip || parentEventForStrip) && <Separator className="my-3" />}
        <div className="select-text">
          <div className="flex items-start gap-2">
            <UserAvatar userId={event.pubkey} size="normal" className="shrink-0" deferRemoteAvatar={false} />
            <div className="min-w-0 flex-1">
              <ContentPreview event={event} className="text-base text-foreground whitespace-pre-wrap break-words" />
            </div>
          </div>
        </div>
      </div>
    </SecondaryPageLayout>
  )
}
