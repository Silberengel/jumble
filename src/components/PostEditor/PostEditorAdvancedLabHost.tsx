import type { AdvancedLabBodyHandle } from '@/components/AdvancedEventLab/AdvancedEventLabDialog'
import type { TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'
import {
  useAdvancedEventLabComposer,
} from '@/hooks/useAdvancedEventLabComposer'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import type { TContentWarningDraftOptions } from '@/lib/content-warning'
import type { TEmoji } from '@/types'
import {
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'

const AdvancedEventLabDialog = lazy(
  () => import('@/components/AdvancedEventLab/AdvancedEventLabDialog')
)

export type PostEditorAdvancedLabHandle = {
  advancedLabOpen: boolean
  advancedLabOpenRef: RefObject<boolean>
  openLab: (live: AdvancedEventLabSlice) => void
  insertComposerText: (txt: string) => void
  insertComposerEmoji: (em: string | TEmoji) => void
  appendUploadedUrl: (url: string, treatAsImage: boolean) => void
  persistLabDraft: (payload: AdvancedEventLabSlice) => void
  applyToTipTap: (plain: string) => void
  handleLabOpenChange: (open: boolean, onClose?: () => void) => void
}

export type PostEditorAdvancedLabHostProps = {
  hostRef: RefObject<PostEditorAdvancedLabHandle | null>
  persistenceKey: string
  textareaRef: RefObject<TPostTextareaHandle | null>
  getKind: () => number
  onOpenChange?: (open: boolean) => void
  advancedLabPortalContainer: HTMLElement | null
  advancedLabPortalRef?: RefObject<HTMLElement | null>
  markupMode: 'markdown' | 'asciidoc'
  i18nLanguage: string
  contextEventId: string | null
  previewAuthorPubkey: string | null
  addClientTag: boolean
  contentWarning: TContentWarningDraftOptions | undefined
  onApply: (payload: AdvancedEventLabSlice) => void
  renderFormatToolbar: (ctx: {
    pickerPortalContainer: HTMLElement | null
    toolbarOrientation?: 'horizontal' | 'vertical'
  }) => ReactNode
  composerToolbarPanel: ReactNode
  onLabClose?: () => void
}

export default function PostEditorAdvancedLabHost({
  hostRef,
  persistenceKey,
  textareaRef,
  getKind,
  onOpenChange,
  advancedLabPortalContainer,
  advancedLabPortalRef,
  markupMode,
  i18nLanguage,
  contextEventId,
  previewAuthorPubkey,
  addClientTag,
  contentWarning,
  onApply,
  renderFormatToolbar,
  composerToolbarPanel,
  onLabClose
}: PostEditorAdvancedLabHostProps) {
  const {
    advancedLabOpen,
    advancedLabOpenRef,
    advancedLabBodyApiRef,
    advancedLabInitial,
    openLab,
    persistLabDraft,
    applyToTipTap,
    handleLabOpenChange,
    insertComposerText,
    insertComposerEmoji,
    appendUploadedUrl
  } = useAdvancedEventLabComposer({
    persistenceKey,
    textareaRef,
    getKind,
    onOpenChange
  })

  useImperativeHandle(
    hostRef,
    () => ({
      advancedLabOpen,
      advancedLabOpenRef,
      openLab,
      insertComposerText,
      insertComposerEmoji,
      appendUploadedUrl,
      persistLabDraft,
      applyToTipTap,
      handleLabOpenChange
    }),
    [
      advancedLabOpen,
      openLab,
      insertComposerText,
      insertComposerEmoji,
      appendUploadedUrl,
      persistLabDraft,
      applyToTipTap,
      handleLabOpenChange
    ]
  )

  const renderFormatToolbarRef = useRef(renderFormatToolbar)
  renderFormatToolbarRef.current = renderFormatToolbar

  const stableRenderFormatToolbar = useCallback(
    (ctx: {
      pickerPortalContainer: HTMLElement | null
      toolbarOrientation?: 'horizontal' | 'vertical'
    }) => renderFormatToolbarRef.current(ctx),
    []
  )

  if (
    !advancedLabOpen ||
    !advancedLabInitial ||
    !(advancedLabPortalRef?.current ?? advancedLabPortalContainer)
  ) {
    return null
  }

  const portalTarget = advancedLabPortalRef?.current ?? advancedLabPortalContainer
  if (!portalTarget) return null

  return createPortal(
    <Suspense fallback={null}>
      <AdvancedEventLabDialog
        open={advancedLabOpen}
        onOpenChange={(o) => handleLabOpenChange(o, onLabClose)}
        initial={advancedLabInitial}
        kindEditable={false}
        markupMode={markupMode}
        i18nLanguage={i18nLanguage}
        contextEventId={contextEventId}
        previewAuthorPubkey={previewAuthorPubkey}
        addClientTag={addClientTag}
        contentWarning={contentWarning}
        draftPersistenceKey={advancedLabOpen ? persistenceKey : null}
        bodyApiRef={advancedLabBodyApiRef as RefObject<AdvancedLabBodyHandle | null>}
        portalContainer={portalTarget}
        portalBackdrop
        renderFormatToolbar={stableRenderFormatToolbar}
        composerToolbarPanel={composerToolbarPanel}
        onApply={onApply}
      />
    </Suspense>,
    portalTarget
  )
}
