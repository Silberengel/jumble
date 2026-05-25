import { Button } from '@/components/ui/button'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { cn } from '@/lib/utils'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

function useDiscussionsSpellNav() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell
  const active =
    display && current === 'spells' && primaryViewType === null && spell === 'discussions'

  const go = () => {
    if (primaryViewType !== null) {
      setPrimaryNoteView(null)
    }
    navigate('spells', { spell: 'discussions' })
  }

  return { active, go }
}

export default function DiscussionsButton() {
  const { active, go } = useDiscussionsSpellNav()

  return (
    <SidebarItem title="Discussions" onClick={go} active={active}>
      <MessageSquare strokeWidth={3} />
    </SidebarItem>
  )
}

export function DiscussionsTitlebarButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { active, go } = useDiscussionsSpellNav()

  return (
    <Button
      variant="ghost"
      size="titlebar-icon"
      title={t('Discussions')}
      aria-label={t('Discussions')}
      className={cn('shrink-0', active && 'bg-accent/50', className)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        go()
      }}
    >
      <MessageSquare />
    </Button>
  )
}
