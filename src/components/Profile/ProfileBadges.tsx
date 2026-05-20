import { Skeleton } from '@/components/ui/skeleton'
import { useProfileWall } from '@/hooks/useProfileWall'
import { useTranslation } from 'react-i18next'

export default function ProfileBadges({
  pubkey,
  profileEventId
}: {
  pubkey: string
  profileEventId?: string
}) {
  const { t } = useTranslation()
  const { badges, isLoading } = useProfileWall(pubkey, profileEventId)

  if (isLoading && badges.length === 0) {
    return (
      <div className="mt-3 flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-14 w-14 rounded-lg" />
        <Skeleton className="h-14 w-14 rounded-lg" />
      </div>
    )
  }

  if (badges.length === 0) return null

  return (
    <section className="mt-3 min-w-0" aria-label={t('Badges')}>
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <div
            key={`${badge.definitionCoordinate}:${badge.awardEventId}`}
            className="flex max-w-[5.5rem] flex-col items-center gap-0.5"
            title={badge.description ?? badge.name}
          >
            {badge.imageUrl ? (
              <img
                src={badge.imageUrl}
                alt={badge.name}
                className="h-14 w-14 rounded-lg border border-border object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-muted px-1 text-center text-[10px] font-medium leading-tight"
                aria-hidden
              >
                {badge.name}
              </div>
            )}
            <span className="w-full truncate text-center text-[10px] text-muted-foreground">{badge.name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
