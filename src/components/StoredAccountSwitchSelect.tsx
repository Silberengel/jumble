import UserAvatar from '@/components/UserAvatar'
import { cn } from '@/lib/utils'
import { formatPubkey, hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  className?: string
  triggerClassName?: string
  /** Show the inline label on narrow viewports (e.g. full-screen post composer). */
  showLabelAlways?: boolean
  /** Separator under the row (e.g. post editor header). */
  withBottomBorder?: boolean
}

/**
 * Switch {@link useNostr} session among stored accounts (same as notifications spell).
 * Renders nothing when there is only one stored account or no session.
 *
 * Uses a native {@link HTMLSelectElement} instead of Radix Select: nested `UserAvatar` /
 * `Username` inside `SelectItem` composes refs in ways that have triggered
 * “Maximum update depth exceeded” on this page (Radix `compose-refs` + frequent re-renders).
 */
export default function StoredAccountSwitchSelect({
  className,
  triggerClassName,
  showLabelAlways = false,
  withBottomBorder = false
}: Props) {
  const { t } = useTranslation()
  const { pubkey, accounts, switchAccount, isAccountSessionHydrating } = useNostr()

  const sessionPubkey = useMemo(() => {
    const cur = pubkey?.trim()
    return cur ? normalizeHexPubkey(cur) : null
  }, [pubkey])

  const storedAccountPubkeys = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const a of accounts) {
      const raw = a.pubkey?.trim()
      if (!raw) continue
      const p = normalizeHexPubkey(raw)
      if (!seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
    }
    return out
  }, [accounts])

  const handlePick = useCallback(
    async (v: string) => {
      const target = normalizeHexPubkey(v)
      if (pubkey && hexPubkeysEqual(target, normalizeHexPubkey(pubkey))) return
      const nextAccount = accounts.find((a) => hexPubkeysEqual(normalizeHexPubkey(a.pubkey), target))
      if (!nextAccount) {
        toast.error(t('notificationsSwitchAccountFailed'))
        return
      }
      const switched = await switchAccount(nextAccount)
      if (!switched || !hexPubkeysEqual(normalizeHexPubkey(switched), target)) {
        toast.error(t('notificationsSwitchAccountFailed'))
      }
    },
    [pubkey, accounts, switchAccount, t]
  )

  if (storedAccountPubkeys.length <= 1 || !sessionPubkey) return null

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        withBottomBorder && '-mx-1 mb-1 border-b border-border/60 px-1 pb-3',
        className
      )}
    >
      <span
        className={cn(
          'shrink-0 text-xs text-muted-foreground',
          showLabelAlways ? 'inline' : 'hidden sm:inline'
        )}
      >
        {t('notificationsViewAsAccount')}
      </span>
      <UserAvatar userId={sessionPubkey} size="small" className="shrink-0" />
      <select
        className={cn(
          'h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName
        )}
        value={sessionPubkey}
        disabled={isAccountSessionHydrating}
        aria-label={t('notificationsViewAsAccountAria')}
        onChange={(e) => void handlePick(e.target.value)}
      >
        {storedAccountPubkeys.map((pk) => (
          <option key={pk} value={pk}>
            {formatPubkey(pk)}
          </option>
        ))}
      </select>
    </div>
  )
}
