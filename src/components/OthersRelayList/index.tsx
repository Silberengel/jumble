import { useSmartRelayNavigation } from '@/PageManager'
import RelaySettingsKindNotice from '@/components/RelaySettingsKindNotice'
import { Badge } from '@/components/ui/badge'
import { kinds } from 'nostr-tools'
import { useFetchRelayInfo, useFetchRelayList } from '@/hooks'
import { toRelay } from '@/lib/link'
import { userIdToPubkey } from '@/lib/pubkey'
import { TMailboxRelay } from '@/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import RelaySimpleInfo from '../RelaySimpleInfo'

export default function OthersRelayList({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const pubkey = useMemo(() => userIdToPubkey(userId), [userId])
  const { relayList, isFetching, showingRelayListFallback } = useFetchRelayList(pubkey)

  if (isFetching) {
    return <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
  }

  return (
    <div className="space-y-4">
      <RelaySettingsKindNotice kinds={[kinds.RelayList]} variant="view" />
      {showingRelayListFallback && (
        <p
          className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          role="status"
        >
          {t('othersRelayListKind10002Fallback', {
            defaultValue:
              'No usable NIP-65 relay list (kind 10002) was found for this user. Profile-index mirrors alone do not count. Network reads/writes use default FAST relays; nothing is shown below as a published mailbox.'
          })}
        </p>
      )}
      {relayList.originalRelays.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('othersRelayListEmpty', {
            defaultValue: 'No published relay URLs to show for this user.'
          })}
        </p>
      ) : (
        relayList.originalRelays.map((relay, index) => (
          <RelayItem key={`read-${relay.url}-${index}`} relay={relay} />
        ))
      )}
    </div>
  )
}

function RelayItem({ relay }: { relay: TMailboxRelay }) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayInfo } = useFetchRelayInfo(relay.url)
  const { url, scope } = relay

  return (
    <div className="p-4 rounded-lg border clickable space-y-1" onClick={() => navigateToRelay(toRelay(url))}>
      <RelaySimpleInfo relayInfo={relayInfo} />
      <div className="flex gap-2">
        {['both', 'read'].includes(scope) && (
          <Badge className="bg-blue-400 hover:bg-blue-400/80">{t('Read')}</Badge>
        )}
        {['both', 'write'].includes(scope) && (
          <Badge className="bg-green-400 hover:bg-green-400/80">{t('Write')}</Badge>
        )}
      </div>
    </div>
  )
}
