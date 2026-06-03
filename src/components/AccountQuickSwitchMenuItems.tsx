import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  accountPointerKey,
  isRedundantAccountPick,
  isSameAccountPubkey,
  listSwitchableAccounts
} from '@/lib/account'
import { formatPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import type { TAccountPointer } from '@/types'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function AccountQuickSwitchMenuItems({ onAfterSwitch }: { onAfterSwitch?: () => void }) {
  const { t } = useTranslation()
  const {
    accounts,
    account,
    switchAccount,
    retryNip07SignerForPreferredAccount
  } = useNostr()
  const rows = listSwitchableAccounts(accounts)

  if (rows.length <= 1) return null

  const handleSwitch = async (act: TAccountPointer) => {
    if (isRedundantAccountPick(act, account)) {
      if (account?.signerType === 'npub' && act.signerType === 'nip-07') {
        const switched = await switchAccount(act)
        if (switched) {
          onAfterSwitch?.()
          return
        }
        const ok = await retryNip07SignerForPreferredAccount()
        if (ok) {
          toast.success(t('accountSwitch.extensionConnected'))
          onAfterSwitch?.()
        } else {
          toast.error(t('accountSwitch.extensionUnavailable'))
        }
      }
      return
    }
    const switched = await switchAccount(act)
    if (!switched) {
      toast.error(t('notificationsSwitchAccountFailed'))
      return
    }
    onAfterSwitch?.()
  }

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {t('notificationsViewAsAccount')}
      </DropdownMenuLabel>
      {rows.map((act) => {
        const active =
          account != null &&
          isSameAccountPubkey(act, account) &&
          (account.signerType === act.signerType ||
            (account.signerType === 'npub' && act.signerType === 'nip-07'))
        return (
          <DropdownMenuItem
            key={accountPointerKey(act)}
            className="gap-2"
            onClick={() => void handleSwitch(act)}
          >
            <SimpleUserAvatar userId={act.pubkey} size="small" className="shrink-0" />
            <span className="min-w-0 flex-1">
              <SimpleUsername userId={act.pubkey} className="block truncate text-sm font-medium" />
              <span className="block truncate text-xs text-muted-foreground">
                {formatPubkey(act.pubkey)}
              </span>
            </span>
            <Check className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
          </DropdownMenuItem>
        )
      })}
      <DropdownMenuSeparator />
    </>
  )
}
