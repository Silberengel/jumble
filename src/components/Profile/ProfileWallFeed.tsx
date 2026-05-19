import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfileWall } from '@/hooks/useProfileWall'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

type ProfileWallFeedProps = {
  pubkey: string
  profileEventId?: string
}

const ProfileWallFeed = forwardRef<{ refresh: () => void }, ProfileWallFeedProps>(
  ({ pubkey, profileEventId }, ref) => {
    const { t } = useTranslation()
    const { badges, comments, isLoading, refresh } = useProfileWall(pubkey, profileEventId)
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

    if (isLoading && badges.length === 0 && comments.length === 0) {
      return (
        <div className="mt-4 space-y-6 px-4">
          <div className="flex gap-3">
            <Skeleton className="h-24 w-24 rounded-full md:h-48 md:w-48" />
            <Skeleton className="h-24 w-24 rounded-full md:h-48 md:w-48" />
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
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
            {t('Refreshing wall...')}
          </div>
        )}

        {badges.length > 0 && (
          <section className="px-4" aria-label={t('Badges')}>
            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              {badges.map((badge) => (
                <div
                  key={`${badge.definitionCoordinate}:${badge.awardEventId}`}
                  className="flex flex-col items-center gap-1"
                  title={badge.description ?? badge.name}
                >
                  {badge.imageUrl ? (
                    <img
                      src={badge.imageUrl}
                      alt={badge.name}
                      className="h-24 w-24 rounded-lg object-cover md:h-48 md:w-48"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-muted px-2 text-center text-xs font-medium md:h-48 md:w-48 md:text-sm"
                      aria-hidden
                    >
                      {badge.name}
                    </div>
                  )}
                  <span className="max-w-[6rem] truncate text-center text-xs text-muted-foreground md:max-w-[12rem]">
                    {badge.name}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2" aria-labelledby="profile-wall-comments-heading">
          <h2 id="profile-wall-comments-heading" className="px-4 text-sm font-semibold text-foreground">
            {t('Wall')}
          </h2>
          {!profileEventId ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t('Profile metadata not loaded yet')}</p>
          ) : comments.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t('No wall comments yet')}</p>
          ) : (
            <div className="space-y-2">
              {comments.map((event) => (
                <NoteCard key={event.id} className="w-full" event={event} filterMutedNotes={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }
)

ProfileWallFeed.displayName = 'ProfileWallFeed'

export default ProfileWallFeed
