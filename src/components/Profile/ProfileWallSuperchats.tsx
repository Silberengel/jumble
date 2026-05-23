import Superchat from '@/components/Note/Superchat'
import Zap from '@/components/Note/Zap'
import { ExtendedKind } from '@/constants'
import { Skeleton } from '@/components/ui/skeleton'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

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

  return (
    <section className="mt-4 min-w-0" aria-label={t('Profile wall superchats')}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('Superchats')}
      </h3>
      <div className="space-y-2">
        {superchats.map((event) =>
          event.kind === ExtendedKind.PAYMENT_NOTIFICATION ? (
            <Superchat key={event.id} event={event} />
          ) : (
            <Zap key={event.id} event={event} />
          )
        )}
      </div>
    </section>
  )
}
