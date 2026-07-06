import MainNoteCard from '@/components/NoteCard/MainNoteCard'
import UnknownNote from '@/components/Note/UnknownNote'
import StandardTextNoteEmbedCard from '@/components/Note/StandardTextNoteEmbedCard'
import { ExtendedKind } from '@/constants'
import { isKindRenderable } from '@/lib/kind-registry/render'
import { normalizeEventKind } from '@/lib/kind-registry/normalize-kind'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'

const COMPACT_TEXT_EMBED_KINDS = new Set<number>([kinds.ShortTextNote, ExtendedKind.COMMENT])

/**
 * Registry-aware embedded note card: standard compact layout for kind 1, full card for other renderable kinds.
 */
export default function EmbeddedKindCard({
  event,
  className,
  originalNoteId,
  showFull = false,
  header
}: {
  event: Event
  className?: string
  originalNoteId?: string
  showFull?: boolean
  header?: React.ReactNode
}) {
  const kind = normalizeEventKind(event.kind)

  if (!Number.isFinite(kind) || !isKindRenderable(kind)) {
    return (
      <UnknownNote
        event={event}
        showAuthorSummary
        className={cn('my-0 p-2 sm:p-3 border rounded-lg w-full', className)}
      />
    )
  }

  if (!showFull && COMPACT_TEXT_EMBED_KINDS.has(kind)) {
    return (
      <StandardTextNoteEmbedCard
        event={event}
        className={cn('w-full', className)}
        header={header}
        originalNoteId={originalNoteId}
      />
    )
  }

  return (
    <MainNoteCard
      className={cn('w-full', className)}
      event={event}
      embedded
      showFull={showFull}
      originalNoteId={originalNoteId}
    />
  )
}
