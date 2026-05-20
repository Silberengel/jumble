import { toNoteList } from '@/lib/link'
import { useSmartHashtagNavigation } from '@/PageManager'

export function EmbeddedHashtag({ hashtag }: { hashtag: string }) {
  const { navigateToHashtag } = useSmartHashtagNavigation()
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const url = toNoteList({ hashtag: hashtag.replace('#', '') })
    navigateToHashtag(url)
  }
  
  return (
    <button
      className="text-primary hover:text-foreground hover:underline underline-offset-2 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      {hashtag}
    </button>
  )
}
