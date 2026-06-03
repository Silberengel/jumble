import { SimpleUserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { formatPubkey, hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { Nip07Signer } from '@/providers/NostrProvider/nip-07.signer'
import { useNostr } from '@/providers/NostrProvider'
import type { TAccountPointer } from '@/types'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  className?: string
  triggerClassName?: string
  /** Show the inline label on narrow viewports (e.g. full-screen post composer). */
  showLabelAlways?: boolean
  /** Separator under the row. */
  withBottomBorder?: boolean
  /** Separator above the row (e.g. post editor footer). */
  withTopBorder?: boolean
  /** Align chips to the end (e.g. beside the publish button). */
  alignEnd?: boolean
}

function dedupeStoredAccounts(accounts: TAccountPointer[]): TAccountPointer[] {
  const seen = new Set<string>()
  const out: TAccountPointer[] = []
  for (const a of accounts) {
    const raw = a.pubkey?.trim()
    if (!raw) continue
    const p = normalizeHexPubkey(raw)
    if (seen.has(p)) continue
    seen.add(p)
    out.push(a)
  }
  return out
}

/**
 * Switch {@link useNostr} session among stored accounts (notifications spell, post editor).
 * Avatar chips instead of a native select; NIP-07 extension sync hint + retry when read-only.
 */
export default function StoredAccountSwitchSelect({
  className,
  showLabelAlways = false,
  withBottomBorder = false,
  withTopBorder = false,
  alignEnd = false
}: Props) {
  const { t } = useTranslation()
  const {
    pubkey,
    account,
    accounts,
    switchAccount,
    isAccountSessionHydrating,
    retryNip07SignerForPreferredAccount,
    adoptExtensionNip07Identity
  } = useNostr()

  const [switchingPubkey, setSwitchingPubkey] = useState<string | null>(null)
  const [retryingExtension, setRetryingExtension] = useState(false)
  const [extensionPubkey, setExtensionPubkey] = useState<string | null>(null)

  const sessionPubkey = useMemo(() => {
    const cur = pubkey?.trim()
    return cur ? normalizeHexPubkey(cur) : null
  }, [pubkey])

  const storedAccounts = useMemo(() => dedupeStoredAccounts(accounts), [accounts])

  const activeStoredAccount = useMemo(() => {
    if (!sessionPubkey) return null
    return (
      storedAccounts.find((a) => hexPubkeysEqual(normalizeHexPubkey(a.pubkey), sessionPubkey)) ?? null
    )
  }, [storedAccounts, sessionPubkey])

  const needsExtensionSync = useMemo(() => {
    if (!activeStoredAccount || !account) return false
    return activeStoredAccount.signerType === 'nip-07' && account.signerType === 'npub'
  }, [activeStoredAccount, account])

  const extensionDiffersFromSession = useMemo(() => {
    if (!extensionPubkey || !sessionPubkey) return false
    return !hexPubkeysEqual(normalizeHexPubkey(extensionPubkey), sessionPubkey)
  }, [extensionPubkey, sessionPubkey])

  useEffect(() => {
    if (!needsExtensionSync) {
      setExtensionPubkey(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const nip07Signer = new Nip07Signer()
        await nip07Signer.init()
        const pk = await nip07Signer.getPublicKey()
        if (cancelled || !pk?.trim()) return
        setExtensionPubkey(pk)
        if (
          sessionPubkey &&
          hexPubkeysEqual(normalizeHexPubkey(pk), sessionPubkey) &&
          !retryingExtension
        ) {
          const ok = await retryNip07SignerForPreferredAccount()
          if (!cancelled && ok) {
            toast.success(t('accountSwitch.extensionConnected'))
          }
        }
      } catch {
        if (!cancelled) setExtensionPubkey(null)
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 2_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [
    needsExtensionSync,
    sessionPubkey,
    retryNip07SignerForPreferredAccount,
    retryingExtension,
    t
  ])

  const handlePick = useCallback(
    async (nextAccount: TAccountPointer) => {
      const target = normalizeHexPubkey(nextAccount.pubkey)
      if (sessionPubkey && hexPubkeysEqual(target, sessionPubkey)) return
      setSwitchingPubkey(target)
      try {
        const switched = await switchAccount(nextAccount)
        if (!switched) {
          toast.error(t('notificationsSwitchAccountFailed'))
          return
        }
        if (!hexPubkeysEqual(normalizeHexPubkey(switched), target)) {
          toast.error(t('notificationsSwitchAccountFailed'))
          return
        }
        if (nextAccount.signerType === 'nip-07') {
          await retryNip07SignerForPreferredAccount()
        }
      } finally {
        setSwitchingPubkey(null)
      }
    },
    [sessionPubkey, switchAccount, retryNip07SignerForPreferredAccount, t]
  )

  const handleRetryExtension = useCallback(async () => {
    setRetryingExtension(true)
    try {
      const ok = await retryNip07SignerForPreferredAccount()
      if (ok) {
        toast.success(t('accountSwitch.extensionConnected'))
      } else {
        toast.error(t('accountSwitch.extensionRetryFailed'))
      }
    } finally {
      setRetryingExtension(false)
    }
  }, [retryNip07SignerForPreferredAccount, t])

  if (storedAccounts.length <= 1 || !sessionPubkey) return null

  const busy = isAccountSessionHydrating || switchingPubkey !== null

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2',
        alignEnd && 'items-end',
        withBottomBorder && '-mx-1 mb-1 border-b border-border/60 px-1 pb-3',
        withTopBorder &&
          (alignEnd
            ? '-mx-1 mt-1 border-t border-border/60 px-1 pt-2'
            : '-mx-1 mt-2 border-t border-border/60 px-1 pt-3'),
        className
      )}
      role="group"
      aria-label={t('notificationsViewAsAccountAria')}
    >
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2',
          alignEnd && 'justify-end'
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
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {storedAccounts.map((act) => {
            const pk = normalizeHexPubkey(act.pubkey)
            const isActive = hexPubkeysEqual(pk, sessionPubkey)
            const isSwitching = switchingPubkey !== null && hexPubkeysEqual(pk, switchingPubkey)
            const readOnlyChip =
              isActive && act.signerType === 'nip-07' && account?.signerType === 'npub'
            return (
              <button
                key={`${pk}-${act.signerType}`}
                type="button"
                disabled={busy && !isSwitching}
                aria-pressed={isActive}
                aria-label={t('accountSwitch.selectAccount', {
                  pubkey: formatPubkey(pk),
                  defaultValue: `Switch to ${formatPubkey(pk)}`
                })}
                title={t('accountSwitch.selectAccount', {
                  pubkey: formatPubkey(pk),
                  defaultValue: `Switch to ${formatPubkey(pk)}`
                })}
                className={cn(
                  'relative shrink-0 rounded-full p-0.5 transition-[box-shadow,opacity]',
                  'ring-2 ring-offset-2 ring-offset-background',
                  isActive
                    ? readOnlyChip
                      ? 'ring-amber-500/90'
                      : 'ring-primary'
                    : 'ring-transparent hover:ring-muted-foreground/35',
                  busy && !isSwitching && 'opacity-50'
                )}
                onClick={() => void handlePick(act)}
              >
                <SimpleUserAvatar userId={pk} size="small" deferRemoteAvatar={false} />
                {isSwitching ? (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {needsExtensionSync ? (
        <div
          className={cn(
            'rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-950 dark:text-amber-100',
            alignEnd && 'max-w-md self-end'
          )}
        >
          <p className="leading-relaxed">{t('accountSwitch.extensionSyncHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={retryingExtension || busy}
              onClick={() => void handleRetryExtension()}
            >
              {retryingExtension ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
              ) : null}
              {t('accountSwitch.extensionRetry')}
            </Button>
            {extensionDiffersFromSession ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={retryingExtension || busy}
                onClick={() => void adoptExtensionNip07Identity()}
              >
                {t('nip07.useExtensionIdentity')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
