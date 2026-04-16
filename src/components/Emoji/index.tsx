import { cn } from '@/lib/utils'
import { TEmoji } from '@/types'
import { Heart, ThumbsDown } from 'lucide-react'
import { HTMLAttributes, useState } from 'react'

/** ~4/3 of legacy `size-5` for custom images when no `classNames.img` override. */
export const EMOJI_IMG_DEFAULT_CLASS = 'size-[calc(1.25rem*4/3)]' as const
/** ~4/3 of legacy `size-4` for dense inline contexts (markdown, likes row, etc.). */
export const EMOJI_IMG_INLINE_CLASS = 'size-[calc(1rem*4/3)]' as const

export default function Emoji({
  emoji,
  classNames,
  onImageClick
}: Omit<HTMLAttributes<HTMLDivElement>, 'className'> & {
  emoji: TEmoji | string
  classNames?: {
    text?: string
    img?: string
  }
  /** Custom emoji only: open in media viewer / lightbox. */
  onImageClick?: (e: React.MouseEvent) => void
}) {
  const [hasError, setHasError] = useState(false)

  if (typeof emoji === 'string') {
    if (emoji === '+') {
      return <Heart className={cn(EMOJI_IMG_DEFAULT_CLASS, 'text-red-400 fill-red-400', classNames?.img)} />
    }
    if (emoji === '-') {
      return (
        <ThumbsDown
          className={cn(EMOJI_IMG_DEFAULT_CLASS, 'text-muted-foreground', classNames?.img)}
          strokeWidth={2}
          aria-hidden
        />
      )
    }
    return <span className={cn('whitespace-nowrap', classNames?.text)}>{emoji}</span>
  }

  if (hasError) {
    return (
      <span className={cn('whitespace-nowrap', classNames?.text)}>{`:${emoji.shortcode}:`}</span>
    )
  }

  return (
    <img
      src={emoji.url}
      alt={emoji.shortcode}
      draggable={false}
      className={cn(
        'inline-block rounded-sm',
        EMOJI_IMG_DEFAULT_CLASS,
        onImageClick ? 'cursor-zoom-in' : 'pointer-events-none',
        classNames?.img
      )}
      onLoad={() => {
        setHasError(false)
      }}
      onError={() => {
        setHasError(true)
      }}
      onClick={
        onImageClick
          ? (e) => {
              e.stopPropagation()
              onImageClick(e)
            }
          : undefined
      }
    />
  )
}
