import NoteInteractions from '@/components/NoteInteractions'
import NoteStats from '@/components/NoteStats'
import RssArticleWebBookmarks from '@/components/RssArticleWebBookmarks'
import RssFeedItem from '@/components/RssFeedItem'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { RssFeedItem as TRssFeedItem } from '@/lib/rss-feed-item'
import { createWebOnlyRssFeedItem } from '@/lib/rss-feed-item'
import { isHttpArticleUrl, promoteRssArticleForNostrThread } from '@/lib/rss-web-feed'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { decodeRssArticlePathSegment, createRssThreadRootEvent, canonicalizeRssArticleUrl } from '@/lib/rss-article'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RssArticlePage = forwardRef(
  (
    {
      articleKey,
      index,
      hideTitlebar = false,
      initialItem
    }: {
      articleKey: string
      index?: number
      hideTitlebar?: boolean
      initialItem?: TRssFeedItem
    },
    ref
  ) => {
    const { t } = useTranslation()
    const [rssFeedReadOnly, setRssFeedReadOnly] = useState(() => {
      try {
        return new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
      } catch {
        return false
      }
    })
    const [threadUnlocked, setThreadUnlocked] = useState(false)
    const [promotingThread, setPromotingThread] = useState(false)
    const showNostrThread = !rssFeedReadOnly || threadUnlocked
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const [contentKey, setContentKey] = useState(0)
    const [threadRefreshToken, setThreadRefreshToken] = useState(0)
    const bumpThreadRefresh = useCallback(() => setThreadRefreshToken((n) => n + 1), [])

    const articleUrl = useMemo(() => {
      try {
        return decodeRssArticlePathSegment(articleKey)
      } catch {
        return ''
      }
    }, [articleKey])

    useEffect(() => {
      setThreadUnlocked(false)
      try {
        setRssFeedReadOnly(
          new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
        )
      } catch {
        setRssFeedReadOnly(false)
      }
    }, [articleKey])

    useEffect(() => {
      const sync = () => {
        try {
          setRssFeedReadOnly(
            new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
          )
        } catch {
          setRssFeedReadOnly(false)
        }
      }
      window.addEventListener('popstate', sync)
      return () => window.removeEventListener('popstate', sync)
    }, [])

    const displayItem = useMemo(() => {
      if (!articleUrl) return null
      if (initialItem && canonicalizeRssArticleUrl(initialItem.link) === canonicalizeRssArticleUrl(articleUrl)) {
        return initialItem
      }
      if (isHttpArticleUrl(articleUrl)) {
        return createWebOnlyRssFeedItem(articleUrl)
      }
      return null
    }, [articleUrl, initialItem])

    const syntheticRoot = useMemo(
      () => (articleUrl ? createRssThreadRootEvent(articleUrl) : null),
      [articleUrl]
    )

    useEffect(() => {
      if (hideTitlebar) {
        sessionStorage.setItem('notePageTitle', displayItem ? t('RSS article') : t('Web page'))
      }
      return () => {
        if (hideTitlebar) {
          sessionStorage.removeItem('notePageTitle')
        }
      }
    }, [hideTitlebar, t, displayItem])

    const refreshArticle = useCallback(() => {
      setContentKey((k) => k + 1)
    }, [])

    const onPromoteForNostrThread = useCallback(async () => {
      if (!articleUrl || !isHttpArticleUrl(articleUrl)) return
      setPromotingThread(true)
      try {
        await promoteRssArticleForNostrThread(articleUrl)
        setThreadUnlocked(true)
      } finally {
        setPromotingThread(false)
      }
    }, [articleUrl])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        refreshArticle()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, refreshArticle])

    const refreshControls = hideTitlebar ? undefined : <RefreshButton onClick={refreshArticle} />

    if (!articleUrl) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('RSS article')}
          controls={refreshControls}
        >
          <div key={contentKey} className="px-4 py-6 text-sm text-muted-foreground">
            {t('Invalid article link.')}
          </div>
        </SecondaryPageLayout>
      )
    }

    const threadBlock = (
      <>
        {rssFeedReadOnly && !threadUnlocked ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{t('RSS read-only thread hint')}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={promotingThread || !isHttpArticleUrl(articleUrl)}
              onClick={() => void onPromoteForNostrThread()}
            >
              {t('Respond to this RSS entry')}
            </Button>
          </div>
        ) : null}
        {isHttpArticleUrl(articleUrl) ? (
          <div className="pt-2">
            <RssArticleWebBookmarks articleUrl={articleUrl} onPublished={bumpThreadRefresh} />
          </div>
        ) : null}
        {showNostrThread && syntheticRoot ? (
          <div className="px-0 w-full">
            <NoteStats
              className="mt-2"
              event={syntheticRoot}
              fetchIfNotExisting
              foregroundStats
            />
          </div>
        ) : null}
        {showNostrThread ? <Separator /> : null}
        <div className="w-full">
          {showNostrThread && syntheticRoot ? (
            <NoteInteractions
              key={`rss-interactions-${syntheticRoot.id}`}
              pageIndex={index}
              event={syntheticRoot}
              showQuotes={false}
              statsForeground
              refreshToken={threadRefreshToken}
            />
          ) : null}
        </div>
      </>
    )

    if (!displayItem) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('Web page')}
          controls={refreshControls}
          displayScrollToTopButton
        >
          <div key={contentKey} className="px-4 pt-3 pb-4 w-full space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('Opened by URL — not from your RSS list. Nostr thread is still tied to this link.')}
            </p>
            {threadBlock}
          </div>
        </SecondaryPageLayout>
      )
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('RSS article')}
        controls={refreshControls}
        displayScrollToTopButton
      >
        <div key={contentKey} className="min-w-0">
          <div className="px-4 pt-3 w-full space-y-3">
            <RssFeedItem
              item={displayItem}
              layout="detail"
              readOnlyHighlights={rssFeedReadOnly && !threadUnlocked}
            />
            {threadBlock}
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
)

RssArticlePage.displayName = 'RssArticlePage'
export default RssArticlePage
