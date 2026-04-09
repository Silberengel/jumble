import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getLiveEventMetadataFromEvent } from '@/lib/event-metadata'
import {
  liveEventInlinePlaybackFromEvent,
  preferredLiveJoinUrlForEvent
} from '@/lib/live-activities'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'
import Image from '../Image'
import MediaPlayer from '../MediaPlayer'

export default function LiveEvent({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const metadata = useMemo(() => getLiveEventMetadataFromEvent(event), [event])
  const playback = useMemo(() => liveEventInlinePlaybackFromEvent(event), [event])
  const joinUrl = useMemo(() => preferredLiveJoinUrlForEvent(event), [event])

  const liveStatusComponent =
    metadata.status &&
    (metadata.status === 'live' ? (
      <Badge className="bg-green-400 hover:bg-green-400">live</Badge>
    ) : metadata.status === 'ended' ? (
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

  const summaryComponent = metadata.summary && (
    <div className="text-base text-muted-foreground line-clamp-4 mt-1">{metadata.summary}</div>
  )

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex gap-1 flex-wrap mt-2">
      {metadata.tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  )

  const cover =
    metadata.image && autoLoadMedia ? (
      <Image
        image={{ url: metadata.image, pubkey: event.pubkey }}
        className={cn(
          'bg-muted shrink-0',
          isSmallScreen ? 'w-full aspect-video' : 'aspect-[4/3] xl:aspect-video h-44 w-auto max-w-[min(100%,20rem)]'
        )}
        hideIfError
      />
    ) : null

  return (
    <div className={cn(className, 'space-y-3')}>
      <div className={cn('flex gap-4', isSmallScreen ? 'flex-col' : 'flex-row items-start')}>
        {cover}
        <div className="flex-1 min-w-0 space-y-1">
          {titleComponent}
          {liveStatusComponent}
          {nowPlaying}
          {summaryComponent}
          {tagsComponent}
        </div>
      </div>

      {playback ? (
        <div className="w-full max-w-[400px]" onClick={(e) => e.stopPropagation()}>
          <MediaPlayer src={playback.src} poster={metadata.image} className="w-full" />
        </div>
      ) : null}

      <div
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {joinUrl ? (
          <Button variant="secondary" size="sm" className="w-full sm:w-auto shrink-0" asChild>
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2"
            >
              <ExternalLink className="size-4 shrink-0" />
              {t('Open in browser')}
            </a>
          </Button>
        ) : null}
        <ClientSelect className="w-full sm:w-auto sm:min-w-[12rem] sm:flex-1" event={event} />
      </div>
    </div>
  )
}
