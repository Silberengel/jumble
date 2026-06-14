import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  HOME_FEED_RELAY_SOURCE_FAVORITES,
  homeFeedSourceLabel
} from '@/lib/home-feed-relay-source'
import { cn } from '@/lib/utils'
import { useFeed } from '@/providers/feed-context'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useTranslation } from 'react-i18next'

export default function HomeFeedRelaySourceSelect({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { homeFeedRelaySource, setHomeFeedRelaySource } = useFeed()
  const { relaySets } = useFavoriteRelays()

  if (relaySets.length === 0) {
    return null
  }

  return (
    <Select value={homeFeedRelaySource} onValueChange={setHomeFeedRelaySource}>
      <SelectTrigger
        className={cn(
          'h-8 w-auto min-w-0 max-w-[9.5rem] shrink-0 px-2 text-xs sm:max-w-[10.5rem]',
          className
        )}
        aria-label={t('Choose a relay set')}
      >
        <SelectValue placeholder={t('Choose a relay set')}>
          {homeFeedSourceLabel(homeFeedRelaySource, relaySets, t)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={HOME_FEED_RELAY_SOURCE_FAVORITES}>{t('All favorite relays')}</SelectItem>
        {relaySets.map((relaySet) => (
          <SelectItem key={relaySet.id} value={relaySet.id}>
            {relaySet.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
