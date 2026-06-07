import { Button } from '@/components/ui/button'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function LibraryButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title={t('Library')}
      onClick={() => navigate('library')}
      active={current === 'library' && display && primaryViewType === null}
    >
      <BookOpen strokeWidth={3} />
    </SidebarItem>
  )
}

export function LibraryTitlebarButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const active = display && current === 'library' && primaryViewType === null

  return (
    <Button
      variant="ghost"
      size="titlebar-icon"
      title={t('Library')}
      aria-label={t('Library')}
      className={cn('shrink-0', active && 'bg-accent/50', className)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigate('library')
      }}
    >
      <BookOpen className="size-5" strokeWidth={2.5} />
    </Button>
  )
}
