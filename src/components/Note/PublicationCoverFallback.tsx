import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'
import {
  LIBRARY_PUBLICATION_COVER_MAX_CLASS,
  PUBLICATION_COVER_MAX_CLASS
} from './PublicationCoverImage'

export default function PublicationCoverFallback({
  layout,
  size = 'default',
  className
}: {
  layout: 'stacked' | 'row'
  size?: 'library' | 'default'
  className?: string
}) {
  const maxClass = size === 'library' ? LIBRARY_PUBLICATION_COVER_MAX_CLASS : PUBLICATION_COVER_MAX_CLASS

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
        maxClass,
        layout === 'stacked' ? 'aspect-[3/4] w-full' : 'aspect-[3/4] w-full max-w-[9rem] sm:max-w-[10rem]',
        layout === 'stacked' && size === 'default' && 'mb-3',
        layout === 'stacked' && size === 'library' && 'mb-2',
        className
      )}
    >
      <BookOpen className={size === 'library' ? 'size-8' : 'size-10'} aria-hidden />
    </div>
  )
}
