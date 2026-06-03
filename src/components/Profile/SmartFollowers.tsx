import { useNostrArchivesSocial } from '@/hooks/useNostrArchivesSocial'
import { toFollowersList } from '@/lib/link'
import { useSmartFollowersListNavigation } from '@/PageManager'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

export default function SmartFollowers({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { followersCount, isFetching, showFollowers } = useNostrArchivesSocial(pubkey)
  const { navigateToFollowersList } = useSmartFollowersListNavigation()

  if (!showFollowers) return null

  const handleClick = () => {
    navigateToFollowersList(toFollowersList(pubkey))
  }

  return (
    <span
      className="flex gap-1 hover:underline w-fit items-center cursor-pointer"
      onClick={handleClick}
      title={t('Nostr Archives followers hint')}
    >
      {isFetching ? (
        <Skeleton className="inline-block size-4 shrink-0 rounded-sm" aria-hidden />
      ) : (
        followersCount
      )}
      <div className="text-muted-foreground">{t('Followers')}</div>
    </span>
  )
}
