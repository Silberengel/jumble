import PostContent from '@/components/PostEditor/PostContent'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import type { TDiscussionDynamicTopics } from '@/lib/discussion-thread-composer'
import type { Event } from 'nostr-tools'
import type { RefObject } from 'react'

export type ComposerContentProps = {
  open: boolean
  defaultContent?: string
  parentEvent?: Event
  close: () => void
  openFrom?: string[]
  initialHighlightData?: HighlightData
  initialPublicMessageTo?: string
  onPublishSuccess?: () => void
  discussionDynamicTopics?: TDiscussionDynamicTopics | null
  pickerPortalContainer?: HTMLElement | null
  advancedLabPortalContainer?: HTMLElement | null
  advancedLabPortalRef?: RefObject<HTMLElement | null>
  onAdvancedLabOpenChange?: (open: boolean) => void
  layoutMode?: 'dialog' | 'page'
  composerMode?: 'full' | 'reply' | 'note' | 'discussion' | 'article'
  onOpenOptions?: () => void
  onPublishRequestRef?: RefObject<(() => void) | null>
  onComposerUiStateChange?: (state: {
    publishDisabled: boolean
    posting: boolean
    blockMessage: string | null
    publishLabel?: string
    hasDraft?: boolean
    relaySelectedTotal?: number
  }) => void
}

export function ComposerContent(props: ComposerContentProps) {
  return <PostContent {...props} />
}

/** Reply / PM-reply fast path on mobile composer page. */
export function SimpleReplyComposer(props: Omit<ComposerContentProps, 'composerMode'>) {
  return <PostContent {...props} layoutMode="page" composerMode="reply" />
}

export function NoteComposer(props: Omit<ComposerContentProps, 'composerMode'>) {
  return <PostContent {...props} layoutMode="page" composerMode="note" />
}

export function DiscussionComposer(props: Omit<ComposerContentProps, 'composerMode'>) {
  return <PostContent {...props} layoutMode="page" composerMode="discussion" />
}

export function ArticleComposer(props: Omit<ComposerContentProps, 'composerMode'>) {
  return <PostContent {...props} layoutMode="page" composerMode="article" />
}

export function pickComposerMode(props: {
  parentEvent?: Event
  isDiscussionThread?: boolean
  isArticleMode?: boolean
}): ComposerContentProps['composerMode'] {
  if (props.parentEvent) return 'reply'
  if (props.isDiscussionThread) return 'discussion'
  if (props.isArticleMode) return 'article'
  return 'note'
}
