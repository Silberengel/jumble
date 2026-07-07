import ContentImage from '@/components/Image'
import UserAvatar from '@/components/UserAvatar'
import { ExtendedKind } from '@/constants'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import type { ReactNode } from 'react'

/** Cropped hero height for article / link-preview cards (portrait sources are center-cropped). */
export const ARTICLE_HERO_ASPECT = 'aspect-[2/1] max-h-44 sm:max-h-52'

/** Reserve 2:1 on {@link ContentImage} wrapper so portrait sources center-crop instead of clipping from the top. */
export const ARTICLE_HERO_COVER_DIM = { width: 2, height: 1 } as const

export const ARTICLE_HERO_IMAGE_CLASS =
  'h-full w-full rounded-none object-cover object-center [object-position:center_center]'

export const ARTICLE_HERO_IMAGE_WRAPPER_CLASS = 'absolute inset-0 block h-full w-full'

const HERO_GRADIENT =
  'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/15'

export function isArticleHeroCardKind(kind: number): boolean {
  return (
    kind === kinds.LongFormArticle ||
    kind === ExtendedKind.WIKI_ARTICLE ||
    kind === ExtendedKind.PUBLICATION ||
    kind === ExtendedKind.PUBLICATION_CONTENT ||
    kind === ExtendedKind.NOSTR_SPECIFICATION
  )
}

function ArticleHeroMedia({
  event,
  imageUrl,
  autoLoadMedia,
  hideImageIfError
}: {
  event: Event
  imageUrl?: string | null
  autoLoadMedia?: boolean
  hideImageIfError?: boolean
}) {
  const autoLoadFromPolicy = useShouldAutoLoadMedia(event.pubkey, event)
  const autoLoad = autoLoadMedia ?? autoLoadFromPolicy
  const trimmed = imageUrl?.trim()

  if (trimmed) {
    return (
      <>
        <ContentImage
          image={{ url: trimmed, pubkey: event.pubkey, dim: ARTICLE_HERO_COVER_DIM }}
          className={ARTICLE_HERO_IMAGE_CLASS}
          classNames={{ wrapper: ARTICLE_HERO_IMAGE_WRAPPER_CLASS }}
          hideIfError={hideImageIfError}
          holdUntilClick={!autoLoad}
        />
        <div className={HERO_GRADIENT} aria-hidden />
      </>
    )
  }

  return (
    <>
      <div className="absolute inset-0 bg-muted" />
      <div className="absolute inset-0 flex items-center justify-center opacity-35">
        <UserAvatar
          userId={event.pubkey}
          size="large"
          deferRemoteAvatar={false}
          className="!h-24 !w-24 rounded-xl"
        />
      </div>
      <div className={HERO_GRADIENT} aria-hidden />
    </>
  )
}

export default function ArticleHeroCard({
  event,
  imageUrl,
  autoLoadMedia,
  hideImageIfError,
  eyebrow,
  title,
  summary,
  footer,
  className,
  cardClassName,
  heroClassName,
  onClick
}: {
  event: Event
  imageUrl?: string | null
  autoLoadMedia?: boolean
  hideImageIfError?: boolean
  eyebrow?: ReactNode
  title?: ReactNode
  summary?: ReactNode
  footer?: ReactNode
  className?: string
  cardClassName?: string
  heroClassName?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const hasOverlayText = Boolean(eyebrow || title || summary)

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        className={cn('overflow-hidden rounded-lg border transition-colors', cardClassName)}
        onClick={onClick}
      >
        <div className={cn('relative w-full overflow-hidden', ARTICLE_HERO_ASPECT, heroClassName)}>
          <ArticleHeroMedia
            event={event}
            imageUrl={imageUrl}
            autoLoadMedia={autoLoadMedia}
            hideImageIfError={hideImageIfError}
          />
          {hasOverlayText ? (
            <div className="absolute inset-0 z-[1] flex min-h-0 min-w-0 flex-col justify-end p-3 pt-8">
              {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
              {title ? (
                <div className="line-clamp-2 break-words text-lg font-semibold text-white sm:text-xl">
                  {title}
                </div>
              ) : null}
              {summary ? (
                <div className="mt-0.5 line-clamp-2 break-words text-sm text-white/85">{summary}</div>
              ) : null}
            </div>
          ) : null}
        </div>
        {footer ? <div className="min-w-0 space-y-2 p-3 pt-2">{footer}</div> : null}
      </div>
    </div>
  )
}
