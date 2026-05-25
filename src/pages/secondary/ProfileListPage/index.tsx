import { Favicon } from '@/components/Favicon'
import ProfileListByNip05Domain from '@/components/Nip05DomainPanel/ProfileListByNip05Domain'
import { ProfileListBySearch } from '@/components/ProfileListBySearch'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { buildAlexandriaEventsSearchUrlForTSearchParams } from '@/lib/alexandria-events-search-url'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ProfileListPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const [listKey, setListKey] = useState(0)
  const bumpList = useCallback(() => setListKey((k) => k + 1), [])
  const [title, setTitle] = useState<React.ReactNode>()
  const [data, setData] = useState<{
    type: 'search' | 'domain'
    id: string
  } | null>(null)

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const search = searchParams.get('s')
    if (search) {
      setTitle(`${t('Search')}: ${search}`)
      setData({ type: 'search', id: search })
      return
    }

    const domain = searchParams.get('d')
    if (domain) {
      setTitle(
        <div className="flex items-center gap-1">
          {domain}
          <Favicon domain={domain} className="w-5 h-5" />
        </div>
      )
      setData({ type: 'domain', id: domain })
      return
    }
  }, [])

  const profileSearchAlexandriaHref = useMemo(
    () =>
      data?.type === 'search'
        ? buildAlexandriaEventsSearchUrlForTSearchParams({ type: 'profiles', search: data.id })
        : null,
    [data]
  )

  let content: React.ReactNode = null
  if (data?.type === 'search') {
    content = (
      <ProfileListBySearch search={data.id} alexandriaEmptyHref={profileSearchAlexandriaHref} />
    )
  } else if (data?.type === 'domain') {
    content = <ProfileListByNip05Domain domain={data.id} />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={title}
      controls={<RefreshButton onClick={bumpList} />}
      displayScrollToTopButton
    >
      <div key={listKey} className="min-w-0">
        {content}
      </div>
    </SecondaryPageLayout>
  )
})
ProfileListPage.displayName = 'ProfileListPage'
export default ProfileListPage
