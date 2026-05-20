import ReportCard from '@/components/ReportCard'
import { RefreshButton } from '@/components/RefreshButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfileReportsEvents } from '@/hooks/useProfileReportsEvents'
import { useProfileReportsRelayBuilder } from '@/hooks/useProfileReportsRelayBuilder'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ProfileReportsPanel({ pubkey }: { pubkey: string }) {
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

  const handleRefresh = () => {
    setIsRefreshing(true)
    refresh()
  }

  if (isLoading && received.length === 0 && made.length === 0) {
    return (
      <div className="space-y-4 py-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <RefreshButton onClick={handleRefresh} onLongPress={null} />
      </div>
      {isRefreshing && (
        <div
          className="flex items-center justify-center gap-2 py-2 text-center text-sm text-green-500"
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
          className="text-sm font-semibold text-foreground"
        >
          {t('Reports received')}
        </h2>
        {received.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('No reports received')}</p>
        ) : (
          <div className="space-y-2">
            {received.map((event) => (
              <ReportCard key={event.id} className="w-full" event={event} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="profile-reports-made-heading">
        <h2 id="profile-reports-made-heading" className="text-sm font-semibold text-foreground">
          {t('Reports made')}
        </h2>
        {made.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('No reports made')}</p>
        ) : (
          <div className="space-y-2">
            {made.map((event) => (
              <ReportCard key={event.id} className="w-full" event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default function ProfileReportsDialog({
  open,
  onOpenChange,
  pubkey
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pubkey: string
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] max-w-lg flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Reports')}</DialogTitle>
          <DialogDescription>{t('Profile reports dialog description')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {open ? <ProfileReportsPanel key={pubkey} pubkey={pubkey} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
