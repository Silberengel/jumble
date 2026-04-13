import { cn } from '@/lib/utils'
import { TEmoji } from '@/types'
import { Heart, ThumbsDown } from 'lucide-react'
import { HTMLAttributes, useState } from 'react'

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
      return <Heart className={cn('size-5 text-red-400 fill-red-400', classNames?.img)} />
    }
    if (emoji === '-') {
      return (
        <ThumbsDown className={cn('size-5 text-muted-foreground', classNames?.img)} strokeWidth={2} aria-hidden />
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
        'inline-block size-5 rounded-sm',
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
