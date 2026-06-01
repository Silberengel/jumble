import AudioPlayer from '@/components/AudioPlayer'
import {
  getMusicTrackFromEvent,
  musicTrackCaptionContent,
  musicTrackDisplayLine,
  musicTrackMetaLine
} from '@/lib/music-track'
import { primalR2aMirrorForBlossomPrimalUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import MediaPlayer from '../MediaPlayer'

export default function MusicTrackNote({
  event,
  className,
  loadMedia = false
}: {
  event: Event
  className?: string
  loadMedia?: boolean
}) {
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const mustLoad = loadMedia || autoLoadMedia
  const { t } = useTranslation()

  const track = useMemo(() => getMusicTrackFromEvent(event), [event])
  const metaLine = useMemo(() => (track ? musicTrackMetaLine(track) : ''), [track])
  const caption = useMemo(
    () => (track ? musicTrackCaptionContent(event.content, track) : null),
    [event.content, track]
  )
  const audioFallbackSrc = useMemo(
    () => (track ? primalR2aMirrorForBlossomPrimalUrl(track.audioUrl) ?? undefined : undefined),
    [track]
  )

  if (!track) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {t('Invalid music track event', { defaultValue: 'Invalid music track event' })}
      </p>
    )
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className="not-prose w-full max-w-[400px] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex gap-3 p-3">
          {track.imageUrl ? (
            <img
              src={track.imageUrl}
              alt=""
              className="size-16 shrink-0 rounded-md object-cover shadow-sm"
              loading="lazy"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{track.title}</p>
            {track.artist ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{track.artist}</p>
            ) : null}
            {metaLine ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{metaLine}</p>
            ) : null}
          </div>
        </div>
        <div className="border-t border-border px-2 pb-2.5 pt-1.5">
          <AudioPlayer
            src={track.audioUrl}
            fallbackSrc={audioFallbackSrc}
            className="w-full max-w-none"
          />
        </div>
        {track.videoUrl ? (
          <div className="border-t border-border px-2 pb-2 pt-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('Music video', { defaultValue: 'Music video' })}
            </p>
            <MediaPlayer src={track.videoUrl} className="w-full max-w-none" mustLoad={mustLoad} />
          </div>
        ) : null}
      </div>
      {caption ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}

export function musicTrackPreviewText(event: Event): string {
  const track = getMusicTrackFromEvent(event)
  return track ? musicTrackDisplayLine(track) : event.tags.find((t) => t[0] === 'title')?.[1] ?? ''
}
