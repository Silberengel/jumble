import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { Flame } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function FavoritesButton() {
  const { t } = useTranslation()
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const { pubkey } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  if (!pubkey) return null

  return (
    <SidebarItem
      title={t('Heat map')}
      onClick={() => navigate('spells', { spell: 'heatMap' })}
      active={
        display &&
        current === 'spells' &&
        primaryViewType === null &&
        spell === 'heatMap'
      }
    >
      <Flame strokeWidth={3} />
    </SidebarItem>
  )
}
