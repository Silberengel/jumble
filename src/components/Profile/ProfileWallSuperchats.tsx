import Superchat from '@/components/Note/Superchat'
import Zap from '@/components/Note/Zap'
import MoneroTip from '@/components/Note/MoneroTip'
import { ExtendedKind } from '@/constants'
import { isMoneroTipKind } from '@/lib/monero-tip'
import { superchatSectionHeadingClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

/** Roughly five profile-wall superchat rows before scrolling. */
const PROFILE_WALL_SUPERCHAT_SCROLL_MAX_HEIGHT = 'max-h-[28rem]'

const PROFILE_WALL_SUPERCHAT_VISIBLE_CAP = 5

export default function ProfileWallSuperchats({
  superchats,
  isLoading
}: {
  superchats: Event[]
  isLoading?: boolean
}) {
  const { t } = useTranslation()

  if (isLoading && superchats.length === 0) {
    return (
      <div className="mt-3 space-y-2" aria-hidden>
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }

  if (superchats.length === 0) return null

  const scrollable = superchats.length > PROFILE_WALL_SUPERCHAT_VISIBLE_CAP

  return (
    <section className="mt-4 min-w-0" aria-label={t('Profile wall superchats')}>
      <h3 className={cn('mb-2', superchatSectionHeadingClass)}>
        {t('Superchats')}
      </h3>
      <div
        className={cn(
          'space-y-2',
          scrollable &&
            cn(PROFILE_WALL_SUPERCHAT_SCROLL_MAX_HEIGHT, 'overflow-y-auto overscroll-y-contain pr-1')
        )}
      >
        {superchats.map((event) =>
          event.kind === ExtendedKind.PAYMENT_NOTIFICATION ? (
            <Superchat key={event.id} event={event} variant="profileWall" />
          ) : isMoneroTipKind(event.kind) ? (
            <MoneroTip key={event.id} event={event} variant="profileWall" />
          ) : (
            <Zap key={event.id} event={event} variant="profileWall" />
          )
        )}
      </div>
    </section>
  )
}
