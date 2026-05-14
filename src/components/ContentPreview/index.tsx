import { ExtendedKind, isNip71StyleVideoKind } from '@/constants'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import { isMentioningMutedUsers, isNip18RepostKind, isNip25ReactionKind } from '@/lib/event'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import {
  getParentReplyBlurbDisplayText,
  parentReplyPollQuestionBlurb
} from '@/lib/parent-reply-blurb'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { mergeTranslatedNote, useNoteTranslation } from '@/lib/note-translation-display'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CommunityDefinitionPreview from './CommunityDefinitionPreview'
import GroupMetadataPreview from './GroupMetadataPreview'
import HighlightPreview from './HighlightPreview'
import LiveEventPreview from './LiveEventPreview'
import LongFormCard from '../Note/LongFormCard'
import NormalContentPreview from './NormalContentPreview'
import PictureNotePreview from './PictureNotePreview'
import PollPreview from './PollPreview'
import VideoNotePreview from './VideoNotePreview'
import ZapPreview from './ZapPreview'
import DiscussionNote from '../DiscussionNote'
import ApplicationHandlerInfo from '../ApplicationHandlerInfo'
import ApplicationHandlerRecommendation from '../ApplicationHandlerRecommendation'
import FollowPackPreview from './FollowPackPreview'
import ReactionEmojiDisplay from '../Note/ReactionEmojiDisplay'
import NoteKindLabel from '../Note/NoteKindLabel'
import Zap from '../Note/Zap'
import GitRepublicEventCard from '../Note/GitRepublicEventCard'

/** Inert event so hooks can run before `event` is defined. */
const CONTENT_PREVIEW_HOOK_PLACEHOLDER = {
  kind: kinds.ShortTextNote,
  id: '',
  pubkey: '',
  content: '',
  tags: [],
  created_at: 0,
  sig: ''
} as Event

/** Keep spacing/margins on the outer wrapper; put line-clamp on the preview body so it still clamps text. */
function splitPreviewLayoutClasses(className?: string) {
  if (!className?.trim()) return { outer: undefined, body: undefined }
  const tokens = className.trim().split(/\s+/)
  const body: string[] = []
  const outer: string[] = []
  for (const tok of tokens) {
    if (tok.startsWith('line-clamp')) body.push(tok)
    else outer.push(tok)
  }
  return {
    outer: outer.length ? outer.join(' ') : undefined,
    body: body.length ? body.join(' ') : undefined
  }
}

export default function ContentPreview({
  event,
  className,
  /** Inline parent lines (e.g. reply thread): zap receipts match compact thread styling. */
  previewDensity,
  /** Reply-to-parent strip: polls show a short question snippet instead of full poll UI. */
  forParentReplyBlurb = false
}: {
  event?: Event
  className?: string
  previewDensity?: 'default' | 'compact'
  forParentReplyBlurb?: boolean
}) {
  const { t } = useTranslation()
  const noteTr = useNoteTranslation(event?.id ?? '')
  const reactionDisplay = useNotificationReactionDisplay(event ?? CONTENT_PREVIEW_HOOK_PLACEHOLDER)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const contentPolicy = useContentPolicyOptional()
  const hideContentMentioningMutedUsers = contentPolicy?.hideContentMentioningMutedUsers ?? false
  const isMuted = useMemo(
    () => (event ? muteSetHas(mutePubkeySet, event.pubkey) : false),
    [mutePubkeySet, event]
  )
  const isMentioningMuted = useMemo(
    () =>
      hideContentMentioningMutedUsers && event
        ? isMentioningMutedUsers(event, mutePubkeySet)
        : false,
    [event, mutePubkeySet]
  )

  if (!event) {
    return <div className={cn('pointer-events-none', className)}>{`[${t('Note not found')}]`}</div>
  }

  if (isMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>[{t('This user has been muted')}]</div>
    )
  }

  if (isMentioningMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>
        [{t('This note mentions a user you muted')}]
      </div>
    )
  }

  const previewEvent = mergeTranslatedNote(event, noteTr)

  const { outer: previewOuter, body: previewBody } = splitPreviewLayoutClasses(className)

  const withKindRow = (node: React.ReactNode) => (
    <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
      <NoteKindLabel kind={previewEvent.kind} event={previewEvent} size="small" />
      <div className={cn('min-w-0', previewBody)}>{node}</div>
    </div>
  )

  if (
    [
      kinds.ShortTextNote,
      ExtendedKind.COMMENT,
      ExtendedKind.VOICE,
      ExtendedKind.VOICE_COMMENT,
      ExtendedKind.RELAY_REVIEW,
      ExtendedKind.PUBLIC_MESSAGE
    ].includes(event.kind)
  ) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>
            {line || `[${t('Note')}]`}
          </div>
        </div>
      )
    }
    return withKindRow(<NormalContentPreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.DISCUSSION) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>
            {line || `[${t('Discussion')}]`}
          </div>
        </div>
      )
    }
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
        <NoteKindLabel kind={previewEvent.kind} event={previewEvent} size="small" />
        <div className={cn('min-w-0', previewBody)}>
          <DiscussionNote event={previewEvent} size="small" />
        </div>
      </div>
    )
  }

  if (event.kind === kinds.Highlights) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Highlight')}</div>
        </div>
      )
    }
    return withKindRow(<HighlightPreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.WEB_BOOKMARK) {
    const href = getWebBookmarkArticleUrl(previewEvent)
    const title = previewEvent.tags.find((t) => t[0] === 'title')?.[1]?.trim()
    const line = title?.trim() || href?.trim() || t('Web bookmark')
    if (forParentReplyBlurb) {
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line}</div>
        </div>
      )
    }
    return withKindRow(<div className={cn('min-w-0 truncate text-sm', previewBody)}>{line}</div>)
  }

  if (event.kind === ExtendedKind.POLL) {
    if (forParentReplyBlurb) {
      const snippet = parentReplyPollQuestionBlurb(previewEvent.content ?? '')
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate', previewBody)}>{snippet || t('Poll')}</div>
        </div>
      )
    }
    return withKindRow(<PollPreview event={previewEvent} />)
  }

  if (event.kind === kinds.LongFormArticle) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>
            {line || `[${t('Long-form Article')}]`}
          </div>
        </div>
      )
    }
    return withKindRow(<LongFormCard event={previewEvent} interactive={false} />)
  }

  if (isNip71StyleVideoKind(event.kind)) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Video')}</div>
        </div>
      )
    }
    return withKindRow(<VideoNotePreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.PICTURE) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Image')}</div>
        </div>
      )
    }
    return withKindRow(<PictureNotePreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.GROUP_METADATA) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Group')}</div>
        </div>
      )
    }
    return withKindRow(<GroupMetadataPreview event={previewEvent} />)
  }

  if (event.kind === kinds.CommunityDefinition) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Community')}</div>
        </div>
      )
    }
    return withKindRow(<CommunityDefinitionPreview event={previewEvent} />)
  }

  if (event.kind === kinds.LiveEvent) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Live event')}</div>
        </div>
      )
    }
    return withKindRow(<LiveEventPreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.ZAP_REQUEST) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Zap')}</div>
        </div>
      )
    }
    return withKindRow(<ZapPreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.ZAP_RECEIPT || event.kind === kinds.Zap) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Zap')}</div>
        </div>
      )
    }
    if (previewDensity === 'compact') {
      return (
        <div className={cn('min-w-0', previewOuter)}>
          <Zap event={previewEvent} variant="compact" omitSenderHeading className={previewBody} />
        </div>
      )
    }
    return withKindRow(<ZapPreview event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.APPLICATION_HANDLER_INFO) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Note')}</div>
        </div>
      )
    }
    return withKindRow(<ApplicationHandlerInfo event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Note')}</div>
        </div>
      )
    }
    return withKindRow(<ApplicationHandlerRecommendation event={previewEvent} />)
  }

  if (event.kind === ExtendedKind.FOLLOW_PACK) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Follow Pack')}</div>
        </div>
      )
    }
    return withKindRow(<FollowPackPreview event={previewEvent} />)
  }

  if (
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT ||
    event.kind === ExtendedKind.GIT_ISSUE ||
    event.kind === ExtendedKind.GIT_RELEASE
  ) {
    if (forParentReplyBlurb) {
      const line = getParentReplyBlurbDisplayText(previewEvent)
      return (
        <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
          <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line || t('Note')}</div>
        </div>
      )
    }
    return withKindRow(<GitRepublicEventCard variant="compact" event={previewEvent} />)
  }

  if (isNip25ReactionKind(event.kind)) {
    return withKindRow(
      <div className="pointer-events-none flex items-center gap-1.5 text-sm text-muted-foreground">
        {reactionDisplay.status === 'vote_up' ? (
          <span className="text-base leading-none" aria-hidden>
            {DISCUSSION_UPVOTE_DISPLAY}
          </span>
        ) : reactionDisplay.status === 'vote_down' ? (
          <span className="text-base leading-none" aria-hidden>
            {DISCUSSION_DOWNVOTE_DISPLAY}
          </span>
        ) : (
          <ReactionEmojiDisplay event={previewEvent} maxRawLength={24} variant="compact" />
        )}
        {t(notificationReactionSummaryKey(reactionDisplay))}
      </div>
    )
  }

  if (isNip18RepostKind(event.kind)) {
    return withKindRow(
      <div className="pointer-events-none text-sm text-muted-foreground">{t('Notification boost summary')}</div>
    )
  }

  if (event.kind === ExtendedKind.POLL_RESPONSE) {
    return withKindRow(
      <div className="pointer-events-none text-sm text-muted-foreground">
        {t('Notification poll vote summary')}
      </div>
    )
  }

  return withKindRow(<div>[{t('Cannot handle event of kind k', { k: previewEvent.kind })}]</div>)
}
