import CacheEventImportSettings from '@/components/CacheEventImportSettings'
import InBrowserCacheSetting from '@/components/InBrowserCacheSetting'
import EventArchiveCacheSettings from '@/components/EventArchiveCacheSettings'
import LibraryIndexCacheSettings from '@/components/LibraryIndexCacheSettings'
import PrivateKeyRecoverySetting from '@/components/PrivateKeyRecoverySetting'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { isNewUserBackupBannerVisible } from '@/lib/post-signup-backup-prompt'
import { requestNewUserTemplateBroadcast } from '@/lib/new-user-template-broadcast'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef } from '@/types'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CacheSettingsPage = forwardRef<TPageRef, { index?: number; hideTitlebar?: boolean }>(
  ({ index, hideTitlebar = false }, ref) => {
    const { t } = useTranslation()
    const { pubkey } = useNostr()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const layoutRef = useRef<TPageRef>(null)
    const [contentKey, setContentKey] = useState(0)
    const bump = useCallback(() => setContentKey((k) => k + 1), [])

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
        refresh: bump
      }),
      [bump]
    )

    useEffect(() => {
      if (!isNewUserBackupBannerVisible()) return
      const scrollToTop = () => layoutRef.current?.scrollToTop('instant')
      scrollToTop()
      const timer = window.setTimeout(scrollToTop, 100)
      return () => window.clearTimeout(timer)
    }, [])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(bump)
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, bump])

    useEffect(() => {
      return () => {
        if (pubkey) requestNewUserTemplateBroadcast(pubkey)
      }
    }, [pubkey])

    return (
      <SecondaryPageLayout
        ref={layoutRef}
        index={index}
        title={hideTitlebar ? undefined : t('Cache & offline storage')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
      >
        <div key={contentKey} className="px-4 py-3 space-y-6">
          <PrivateKeyRecoverySetting />
          <InBrowserCacheSetting />
          <CacheEventImportSettings />
          <EventArchiveCacheSettings />
          <LibraryIndexCacheSettings />
        </div>
      </SecondaryPageLayout>
    )
  }
)
CacheSettingsPage.displayName = 'CacheSettingsPage'
export default CacheSettingsPage
