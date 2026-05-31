import AboutInfoDialog from '@/components/AboutInfoDialog'
import {
  toGeneralSettings,
  toPostSettings,
  toRelaySettings,
  toCacheSettings,
  toWallet,
  toRssFeedSettings,
  toPersonalListsSettings
} from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartSettingsNavigation } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import {
  ChevronRight,
  Database,
  Info,
  PencilLine,
  Rss,
  Server,
  Settings2,
  Users,
  Wallet
} from 'lucide-react'
import { forwardRef, HTMLProps } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shared settings index rows (General, Relays, …). Used by the primary Settings page and
 * the secondary /settings route for deep links / stack restores.
 */
export default function SettingsMenuBody({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { navigateToSettings } = useSmartSettingsNavigation()

  return (
    <div className={cn('min-w-0', className)}>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toGeneralSettings())}>
        <div className="flex items-center gap-4">
          <Settings2 />
          <div>{t('General')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toRelaySettings())}>
        <div className="flex items-center gap-4">
          <Server />
          <div>{t('Relays and Storage Settings')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toCacheSettings())}>
        <div className="flex items-center gap-4">
          <Database />
          <div>{t('Cache & offline storage')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toWallet())}>
          <div className="flex items-center gap-4">
            <Wallet />
            <div>{t('Wallet')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toPostSettings())}>
          <div className="flex items-center gap-4">
            <PencilLine />
            <div>{t('Post settings')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toRssFeedSettings())}>
          <div className="flex items-center gap-4">
            <Rss />
            <div>{t('RSS Feed Settings')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toPersonalListsSettings())}>
          <div className="flex items-center gap-4">
            <Users />
            <div>{t('Personal Lists')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      <AboutInfoDialog>
        <SettingItem className="clickable">
          <div className="flex items-center gap-4">
            <Info />
            <div>{t('About')}</div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="text-muted-foreground">
              v{import.meta.env.APP_VERSION} ({import.meta.env.GIT_COMMIT})
            </div>
            <ChevronRight />
          </div>
        </SettingItem>
      </AboutInfoDialog>
    </div>
  )
}

const SettingItem = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        className={cn(
          'flex h-[52px] select-none items-center justify-between rounded-lg px-4 py-2 [&_svg]:size-4 [&_svg]:shrink-0',
          className
        )}
        {...props}
        ref={ref}
      >
        {children}
      </div>
    )
  }
)
SettingItem.displayName = 'SettingItem'
