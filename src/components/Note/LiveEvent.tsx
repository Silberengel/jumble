import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createFakeEvent } from '@/lib/event'
import { getLiveEventMetadataFromEvent } from '@/lib/event-metadata'
import {
  liveEventInlinePlaybackFromEvent,
  preferredLiveJoinUrlForEvent
} from '@/lib/live-activities'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'
import Image from '../Image'
import MediaPlayer from '../MediaPlayer'
import MarkdownArticle from './MarkdownArticle/MarkdownArticle'

export default function LiveEvent({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const metadata = useMemo(() => getLiveEventMetadataFromEvent(event), [event])
  const playback = useMemo(() => liveEventInlinePlaybackFromEvent(event), [event])
  const joinUrl = useMemo(() => preferredLiveJoinUrlForEvent(event), [event])
  /** Video/HLS: prefer `thumb`, then `image`. Audio: prefer NIP-53 `image`, then `thumb` (still on the player). */
  const posterUrl = metadata.thumb ?? metadata.image
  const inlinePlayerPoster =
    playback?.mode === 'audio' ? metadata.image ?? metadata.thumb : posterUrl
  /** Side column only when there is no inline player (artwork for audio/video lives on the player). */
  const showSideArtwork = autoLoadMedia && !!posterUrl && !playback

  const summaryMarkdownEvent = useMemo(() => {
    const s = metadata.summary?.trim()
    if (!s) return null
    return createFakeEvent({
      kind: kinds.ShortTextNote,
      pubkey: event.pubkey,
      content: s,
      created_at: event.created_at
    })
  }, [metadata.summary, event.pubkey, event.created_at])

  const statusKey = metadata.status?.toLowerCase()
  const liveStatusComponent =
    statusKey &&
    (statusKey === 'live' ? (
      <Badge className="bg-green-400 hover:bg-green-400">live</Badge>
    ) : statusKey === 'ended' ? (
      <Badge variant="destructive">ended</Badge>
    ) : (
      <Badge variant="secondary">{metadata.status}</Badge>
    ))

  const titleComponent = (
    <div className="text-xl font-semibold break-words min-w-0 sm:line-clamp-1">{metadata.title}</div>
  )

  const nowPlaying =
    event.content?.trim().length > 0 ? (
      <p className="text-sm text-muted-foreground mt-1 line-clamp-4">{event.content.trim()}</p>
    ) : null

  const summaryComponent = summaryMarkdownEvent ? (
    <div
      className="mt-1 min-w-0 w-full text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <MarkdownArticle
        event={summaryMarkdownEvent}
        hideMetadata
        lazyMedia={autoLoadMedia}
        className="prose-sm max-w-none min-w-0 w-full"
      />
    </div>
  ) : null

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex gap-1 flex-wrap mt-2">
      {metadata.tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  )

  const cover = showSideArtwork ? (
    <Image
      image={{ url: posterUrl!, pubkey: event.pubkey }}
      className={cn(
        'bg-muted',
        isSmallScreen ? 'w-full aspect-video' : 'aspect-[4/3] xl:aspect-video h-44 w-full max-h-44'
      )}
      classNames={{
        // Image’s default wrapper is `w-full`; in a row flex that steals the whole row and collapses the text column.
        wrapper: cn(
          'shrink-0',
          isSmallScreen ? 'w-full' : 'w-[min(100%,20rem)]'
        )
      }}
      hideIfError
    />
  ) : null

  return (
    <div className={cn(className, 'min-w-0 w-full space-y-3')}>
      <div
        className={cn(
          'flex min-w-0 w-full gap-4',
          isSmallScreen ? 'flex-col' : 'flex-row items-start'
        )}
      >
        {cover}
        <div className="min-w-0 flex-1 space-y-1">
          {titleComponent}
          {liveStatusComponent}
          {nowPlaying}
          {summaryComponent}
          {tagsComponent}
        </div>
      </div>

      {playback ? (
        <div className="min-w-0 w-full max-w-[400px]" onClick={(e) => e.stopPropagation()}>
          <MediaPlayer
            src={playback.src}
            poster={inlinePlayerPoster}
            className="w-full"
            fallbackPageUrl={joinUrl ?? undefined}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        {joinUrl ? (
          <Button variant="secondary" size="sm" className="h-auto min-h-9 w-full max-w-full justify-center py-2 whitespace-normal" asChild>
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 text-center"
            >
              <ExternalLink className="size-4 shrink-0" />
              {t('Open in browser')}
            </a>
          </Button>
        ) : null}
        <ClientSelect
          className="h-auto min-h-9 w-full max-w-full justify-center py-2 whitespace-normal"
          event={event}
        />
      </div>
    </div>
  )
}
