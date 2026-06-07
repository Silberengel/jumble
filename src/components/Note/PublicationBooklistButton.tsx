import { Button } from '@/components/ui/button'
import { usePublicationBooklist } from '@/hooks/usePublicationBooklist'
import { cn } from '@/lib/utils'
import { BookOpen, Loader2 } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

export default function PublicationBooklistButton({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { isOnBooklist, loading, toggling, toggle, canToggle } = usePublicationBooklist(event)

  if (!canToggle) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'gap-2',
        isOnBooklist
          ? [
              'border-border bg-background text-foreground shadow-none',
              'hover:border-border hover:bg-muted hover:text-foreground',
              'dark:border-border dark:bg-background dark:text-foreground',
              'dark:hover:border-border dark:hover:bg-muted dark:hover:text-foreground'
            ]
          : [
              'border-green-600 bg-green-600 text-white shadow-sm',
              'hover:border-green-700 hover:bg-green-700 hover:text-white',
              'dark:border-green-500 dark:bg-green-600 dark:text-white',
              'dark:hover:border-green-400 dark:hover:bg-green-500 dark:hover:text-white',
              'focus-visible:ring-green-600/40 dark:focus-visible:ring-green-500/40'
            ],
        className
      )}
      disabled={loading || toggling}
      onClick={() => void toggle()}
    >
      {loading || toggling ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <BookOpen className="size-4" aria-hidden />
      )}
      {isOnBooklist ? t('Remove from my booklist') : t('Add to my booklist')}
    </Button>
  )
}
