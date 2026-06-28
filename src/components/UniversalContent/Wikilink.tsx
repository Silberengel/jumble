import { ExtendedKind } from '@/constants'
import { toNoteList } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartHashtagNavigationOptional } from '@/PageManager'

interface WikilinkProps {
  dTag: string
  displayText: string
  className?: string
}

export default function Wikilink({ dTag, displayText, className }: WikilinkProps) {
  const { navigateToHashtag } = useSmartHashtagNavigationOptional()

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!dTag) return
    // Wikilinks target NIP-54 wiki pages, so surface kind 30818 events first in the d-tag browse.
    navigateToHashtag(toNoteList({ domain: dTag, prioritizeKind: ExtendedKind.WIKI_ARTICLE }))
  }

  return (
    <button
      type="button"
      className={cn(
        'text-primary hover:text-foreground hover:underline underline-offset-2 transition-colors cursor-pointer',
        className
      )}
      onClick={handleClick}
    >
      {displayText}
    </button>
  )
}
