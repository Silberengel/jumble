import { ExtendedKind, isNip71StyleVideoKind } from '@/constants'
import { isLongFormNip71VideoEventKind } from '@/lib/long-video-load-policy'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import client from '@/services/client.service'
import { extractAllMediaFromEvent } from '@/services/media-extraction.service'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { Image as ImageIcon, Images, Music, Play } from 'lucide-react'
import { type Event } from 'nostr-tools'
import { useMemo } from 'react'

export default function MediaGridItem({ event }: { event: Event }) {
  const { navigateToNote } = useSmartNoteNavigationOptional()

  const media = useMemo(() => extractAllMediaFromEvent(event), [event])
  const first = media.all[0]

  /** Kind 20 is always treated as image unless imeta explicitly says video (rare mis-tag). */
  const isPictureKind = event.kind === ExtendedKind.PICTURE
  const isLongFormVideo = isLongFormNip71VideoEventKind(event.kind)
  const isVideo =
    (!isPictureKind && first?.m?.startsWith('video/')) ||
    (!isPictureKind && isNip71StyleVideoKind(event.kind))
  const isAudio = first?.m?.startsWith('audio/') || event.kind === ExtendedKind.VOICE
  const hasMultiple = media.all.length > 1

  // For videos prefer the poster image; long-form feed tiles never prefetch the .mp4 (open note to play).
  const displayUrl = isVideo
    ? isLongFormVideo
      ? (first?.image ?? first?.thumb)
      : (first?.image ?? first?.url)
    : (first?.thumb ?? first?.url)

  const handleClick = () => {
    client.addEventToCache(event)
    navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
  }

  return (
    <div
      className="relative aspect-square cursor-pointer overflow-hidden bg-muted"
      onClick={handleClick}
    >
      {displayUrl ? (
        isVideo && !isLongFormVideo && !(first?.image ?? first?.thumb) && first?.url ? (
          <video
            src={first.url}
            className="h-full w-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          <img
            src={displayUrl}
            alt={first?.alt ?? ''}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
          {isAudio ? (
            <Music className="size-8" />
          ) : isVideo ? (
            <Play className="size-8" />
          ) : (
            <ImageIcon className="size-8" />
          )}
        </div>
      )}

      {/* Top-right badge */}
      {isVideo && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Play className="size-6 fill-white text-white" />
        </div>
      )}
      {isAudio && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Music className="size-6 text-white" />
        </div>
      )}
      {hasMultiple && !isVideo && !isAudio && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Images className="size-6 text-white" />
        </div>
      )}
    </div>
  )
}
