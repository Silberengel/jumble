import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfileReportsEvents } from '@/hooks/useProfileReportsEvents'
import { useProfileReportsRelayBuilder } from '@/hooks/useProfileReportsRelayBuilder'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

const ProfileReportsFeed = forwardRef<{ refresh: () => void }, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const relayUrlsBuilder = useProfileReportsRelayBuilder(pubkey)
  const { received, made, isLoading, refresh } = useProfileReportsEvents({
    pubkey,
    relayUrlsBuilder
  })
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (!isLoading) setIsRefreshing(false)
  }, [isLoading])

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        setIsRefreshing(true)
        refresh()
      }
    }),
    [refresh]
  )

  if (isLoading && received.length === 0 && made.length === 0) {
    return (
      <div className="mt-4 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-8">
      {isRefreshing && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-center text-sm text-green-500"
          role="status"
          aria-live="polite"
        >
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t('Refreshing reports...')}
        </div>
      )}

      <section className="space-y-2" aria-labelledby="profile-reports-received-heading">
        <h2
          id="profile-reports-received-heading"
          className="px-4 text-sm font-semibold text-foreground"
        >
          {t('Reports received')}
        </h2>
        {received.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t('No reports received')}</p>
        ) : (
          <div className="space-y-2">
            {received.map((event) => (
              <NoteCard key={event.id} className="w-full" event={event} filterMutedNotes={false} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="profile-reports-made-heading">
        <h2 id="profile-reports-made-heading" className="px-4 text-sm font-semibold text-foreground">
          {t('Reports made')}
        </h2>
        {made.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t('No reports made')}</p>
        ) : (
          <div className="space-y-2">
            {made.map((event) => (
              <NoteCard key={event.id} className="w-full" event={event} filterMutedNotes={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
})

ProfileReportsFeed.displayName = 'ProfileReportsFeed'

export default ProfileReportsFeed
