import {
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useRelayConnectionRows } from '@/hooks/useRelayConnectionRows'
import { useTranslation } from 'react-i18next'
import { ActiveRelaysIconGrid } from './ActiveRelaysIconGrid'

/** Compact active-relay icons in the account (user badge) dropdown. */
export function ActiveRelaysDropdownSection() {
  const { t } = useTranslation()
  const { rows, connectedCount } = useRelayConnectionRows()

  if (rows.length === 0) return null

  const countSummary = `${connectedCount}/${rows.length}`

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-baseline justify-between gap-2 text-xs font-normal">
        <span>{t('Active relays')}</span>
        <span className="tabular-nums text-muted-foreground">{countSummary}</span>
      </DropdownMenuLabel>
      <div
        className="px-2 pb-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ActiveRelaysIconGrid />
      </div>
    </>
  )
}
