import { useNostr } from '@/providers/NostrProvider'
import { useTranslation } from 'react-i18next'

/**
 * Read-only (npub) session helpers for disabling publish / social controls.
 */
export function useSignGatedControl() {
  const { canSignEvents } = useNostr()
  const { t } = useTranslation()
  const readOnlyTitle = t('readOnlySession.hint')

  return {
    canSignEvents,
    /** Merge into button/menu props: disabled + title when read-only. */
    signControlProps: (extra?: { disabled?: boolean; title?: string }) => ({
      disabled: !canSignEvents || Boolean(extra?.disabled),
      title: !canSignEvents ? readOnlyTitle : extra?.title
    })
  }
}
