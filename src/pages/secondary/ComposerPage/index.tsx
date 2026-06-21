import {
  ComposerShell,
  ComposerTitlebar,
  ComposerBody,
  ComposerBlockBanner,
  ComposerFooter,
  ComposerContextRow
} from '@/components/Composer'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { ComposerSessionProvider, useComposerSessionRequired } from '@/contexts/composer-session-context'
import { composerOptionsPathActive } from '@/lib/open-composer'
import { MAX_PUBLISH_RELAYS } from '@/constants'
import {
  parseComposerSearchParams,
  decodeComposerReplySegment
} from '@/lib/composer-navigation'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import client, { eventService } from '@/services/client.service'
import postEditorService from '@/services/post-editor.service'
import { useSecondaryPage } from '@/PageManager'
import type { TPageRef } from '@/types'
import { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AdvancedComposerOptionsPage from './AdvancedComposerOptionsPage'
import {
  SimpleReplyComposer,
  NoteComposer,
  DiscussionComposer,
  ArticleComposer,
  pickComposerMode,
  type ComposerContentProps
} from '@/components/Composer/ComposerModes'
import type { TDiscussionDynamicTopics } from '@/lib/discussion-thread-composer'

export type ComposerPageProps = {
  replySegment?: string
  index?: number
  discussionDynamicTopics?: TDiscussionDynamicTopics | null
}

function ComposerPageInner({
  replySegment,
  discussionDynamicTopics
}: ComposerPageProps) {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const searchParams = parseComposerSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  )
  const session = useComposerSessionRequired()
  const publishRef = useRef<(() => void) | null>(null)
  const clearRef = useRef<(() => void) | null>(null)
  const [pickerPortalContainer, setPickerPortalContainer] = useState<HTMLElement | null>(null)
  const [parentEvent, setParentEvent] = useState<Event | undefined>()
  const [loadingParent, setLoadingParent] = useState(Boolean(replySegment))
  const [title, setTitle] = useState(t('New Note'))
  const [publishLabel, setPublishLabel] = useState(t('Post'))
  const [blockMessage, setBlockMessage] = useState<string | null>(null)
  const [publishDisabled, setPublishDisabled] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [relaySelectedTotal, setRelaySelectedTotal] = useState<number | undefined>()
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

  useEffect(() => {
    postEditorService.setComposerShellOpen(true)
    return () => postEditorService.setComposerShellOpen(false)
  }, [])

  useEffect(() => {
    if (composerOptionsPathActive()) {
      session.setOptionsOpen(true)
    }
    // Only when landing on /compose/options — not on every session update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!replySegment) {
      setParentEvent(undefined)
      setLoadingParent(false)
      setTitle(t('New Note'))
      setPublishLabel(t('Post'))
      return
    }
    const hexOrId = decodeComposerReplySegment(replySegment)
    setLoadingParent(true)
    void (async () => {
      let ev = client.peekSessionCachedEvent(hexOrId)
      if (!ev) ev = await eventService.fetchEvent(hexOrId)
      setParentEvent(ev)
      setLoadingParent(false)
      setTitle(t('Reply to'))
      setPublishLabel(t('Reply'))
    })()
  }, [replySegment, t])

  const close = useCallback(() => {
    if (publishing) return
    pop()
  }, [pop, publishing])

  const requestClose = useCallback(() => {
    if (publishing) return
    if (hasDraft) {
      setDiscardConfirmOpen(true)
      return
    }
    close()
  }, [close, hasDraft, publishing])

  const onOpenOptions = useCallback(() => {
    session.setOptionsOpen(true)
  }, [session.setOptionsOpen])

  const onComposerUiStateChange = useCallback(
    (state: {
      publishDisabled: boolean
      posting: boolean
      blockMessage: string | null
      publishLabel?: string
      hasDraft?: boolean
      relaySelectedTotal?: number
    }) => {
      setPublishDisabled(state.publishDisabled)
      setPublishing(state.posting)
      setBlockMessage(state.blockMessage)
      setHasDraft(Boolean(state.hasDraft))
      setRelaySelectedTotal(state.relaySelectedTotal)
      if (state.publishLabel) setPublishLabel(state.publishLabel)
    },
    []
  )

  const composerMode = pickComposerMode({
    parentEvent,
    isDiscussionThread: false,
    isArticleMode: false
  })

  const ComposerModeComponent: React.ComponentType<Omit<ComposerContentProps, 'composerMode'>> =
    composerMode === 'reply'
      ? SimpleReplyComposer
      : composerMode === 'discussion'
        ? DiscussionComposer
        : composerMode === 'article'
          ? ArticleComposer
          : NoteComposer

  const showRelayChip =
    relaySelectedTotal != null && relaySelectedTotal >= MAX_PUBLISH_RELAYS - 2

  if (session.optionsOpen) {
    return <AdvancedComposerOptionsPage onBack={() => session.setOptionsOpen(false)} />
  }

  if (loadingParent) {
    return (
      <SecondaryPageLayout title={t('Loading…')}>
        <div className="p-4 text-sm text-muted-foreground">{t('Loading…')}</div>
      </SecondaryPageLayout>
    )
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={setPickerPortalContainer}
        data-nested-picker-portal
        className="pointer-events-none absolute inset-0 z-[300] overflow-visible"
        aria-hidden={false}
      />
      <ComposerShell
        pinFooterToViewport
        titlebar={
          <ComposerTitlebar
            title={title}
            onBack={requestClose}
            backDisabled={publishing}
            clearLabel={t('Clear')}
            onClear={() => clearRef.current?.()}
            clearDisabled={publishing}
            publishLabel={publishLabel}
            onPublish={() => publishRef.current?.()}
            publishDisabled={publishDisabled}
            publishing={publishing}
          />
        }
        blockBanner={
          blockMessage ? (
            <ComposerBlockBanner
              message={blockMessage}
              actionLabel={blockMessage.includes('relay') ? t('Fix relays') : undefined}
              onAction={
                blockMessage.includes('relay')
                  ? onOpenOptions
                  : undefined
              }
            />
          ) : null
        }
        context={
          <>
            {parentEvent ? (
              <ComposerContextRow>
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground max-h-24 overflow-y-auto">
                  {parentEvent.content.slice(0, 320)}
                </div>
              </ComposerContextRow>
            ) : null}
            {showRelayChip ? (
              <ComposerContextRow>
                <button
                  type="button"
                  className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-900 dark:text-amber-100"
                  onClick={onOpenOptions}
                >
                  {t('Publish relay cap hint', {
                    max: MAX_PUBLISH_RELAYS,
                    selected: relaySelectedTotal,
                    selectedContacted: relaySelectedTotal
                  })}
                </button>
              </ComposerContextRow>
            ) : null}
          </>
        }
        footer={
          <ComposerFooter>
            <div id="composer-page-footer-slot" className="min-h-[2.5rem]" />
          </ComposerFooter>
        }
      >
        <ComposerBody>
          <ComposerModeComponent
            open
            defaultContent={searchParams.defaultContent ?? ''}
            parentEvent={parentEvent}
            close={close}
            openFrom={searchParams.openFrom}
            initialPublicMessageTo={searchParams.initialPublicMessageTo}
            onPublishSuccess={close}
            discussionDynamicTopics={discussionDynamicTopics}
            pickerPortalContainer={pickerPortalContainer}
            layoutMode="page"
            onOpenOptions={onOpenOptions}
            onPublishRequestRef={publishRef}
            onClearRequestRef={clearRef}
            onComposerUiStateChange={onComposerUiStateChange}
          />
        </ComposerBody>
      </ComposerShell>
    </div>
    <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Discard draft?')}</AlertDialogTitle>
          <AlertDialogDescription>{t('Your unsaved draft will be lost.')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Keep editing')}</AlertDialogCancel>
          <AlertDialogAction onClick={close}>{t('Discard')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

const ComposerPage = forwardRef<TPageRef, ComposerPageProps>(function ComposerPage(props, ref) {
  useImperativeHandle(ref, () => ({
    scrollToTop: (behavior?: ScrollBehavior) => {
      window.scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
    }
  }))

  return (
    <ComposerSessionProvider>
      <ComposerPageInner {...props} />
    </ComposerSessionProvider>
  )
})
ComposerPage.displayName = 'ComposerPage'
export default ComposerPage

/** Open composer on mobile via secondary navigation; no-op on desktop (use PostEditor dialog). */
export function openComposerPage(
  push: (url: string) => void,
  isSmallScreen: boolean,
  url: string
): boolean {
  if (!isSmallScreen) return false
  push(url)
  return true
}
