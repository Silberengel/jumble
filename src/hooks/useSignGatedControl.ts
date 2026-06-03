import { useNostr } from '@/providers/NostrProvider'
import { useTranslation } from 'react-i18next'

/**
 * Read-only (npub) and anon session helpers for disabling publish / social controls.
 */
export function useSignGatedControl() {
  const { canSignEvents, canManageIdentity, isAnonSession } = useNostr()
  const { t } = useTranslation()
  const readOnlyTitle = t('readOnlySession.hint')
  const anonIdentityTitle = t('accountSwitch.anonIdentityDisabled')

  return {
    canSignEvents,
    /** Follow, mute, bookmarks, profile lists — requires a stable logged-in identity. */
    canManageIdentity,
    isAnonSession,
    /** Merge into button/menu props: disabled + title when read-only. */
    signControlProps: (extra?: { disabled?: boolean; title?: string }) => ({
      disabled: !canSignEvents || Boolean(extra?.disabled),
      title: !canSignEvents ? readOnlyTitle : extra?.title
    }),
    /** Merge into follow/mute/profile controls. */
    identityControlProps: (extra?: { disabled?: boolean; title?: string }) => ({
      disabled: !canManageIdentity || Boolean(extra?.disabled),
      title: isAnonSession ? anonIdentityTitle : !canManageIdentity ? readOnlyTitle : extra?.title
    })
  }
}
