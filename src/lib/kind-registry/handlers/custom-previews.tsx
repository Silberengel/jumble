import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import { useTranslation } from 'react-i18next'
import NormalContentPreview from '@/components/ContentPreview/NormalContentPreview'
import StandardTextNoteEmbedCard from '@/components/Note/StandardTextNoteEmbedCard'
import HighlightPreview from '@/components/ContentPreview/HighlightPreview'
import PollPreview from '@/components/ContentPreview/PollPreview'
import LongFormCard from '@/components/Note/LongFormCard'
import VideoNotePreview from '@/components/ContentPreview/VideoNotePreview'
import MusicTrackNotePreview from '@/components/ContentPreview/MusicTrackNotePreview'
import PictureNotePreview from '@/components/ContentPreview/PictureNotePreview'
import GroupMetadataPreview from '@/components/ContentPreview/GroupMetadataPreview'
import CommunityDefinitionPreview from '@/components/ContentPreview/CommunityDefinitionPreview'
import LiveEventPreview from '@/components/ContentPreview/LiveEventPreview'
import ZapPreview from '@/components/ContentPreview/ZapPreview'
import FollowPackPreview from '@/components/ContentPreview/FollowPackPreview'
import DiscussionNote from '@/components/DiscussionNote'
import ApplicationHandlerInfo from '@/components/ApplicationHandlerInfo'
import ApplicationHandlerRecommendation from '@/components/ApplicationHandlerRecommendation'
import GitRepublicEventCard from '@/components/Note/GitRepublicEventCard'
import LearningResourceCard from '@/components/Note/LearningResourceCard'
import ReactionEmojiDisplay from '@/components/Note/ReactionEmojiDisplay'
import Zap from '@/components/Note/Zap'
import MoneroTip from '@/components/Note/MoneroTip'
import CalendarEventContent from '@/components/CalendarEventContent'
import CitationCard from '@/components/CitationCard'
import { cn } from '@/lib/utils'
import type { RenderCtx } from '../types'

export function renderTextContentPreview(ctx: RenderCtx) {
  if (
    ctx.surface === 'embed' ||
    (ctx.surface === 'preview' && ctx.showPaymentAttestationAction)
  ) {
    return (
      <StandardTextNoteEmbedCard
        event={ctx.displayEvent}
        className={ctx.className}
        lineClampClassName={ctx.surface === 'embed' ? 'line-clamp-4' : 'line-clamp-3'}
        deferAuthorAvatar={ctx.deferAuthorAvatar}
      />
    )
  }
  return <NormalContentPreview event={ctx.displayEvent} className={ctx.className} />
}

export function renderDiscussionPreview(ctx: RenderCtx) {
  return <DiscussionNote event={ctx.displayEvent} size="small" />
}

export function renderHighlightPreview(ctx: RenderCtx) {
  return <HighlightPreview event={ctx.displayEvent} />
}

export function renderWebBookmarkPreview(ctx: RenderCtx) {
  const href = getWebBookmarkArticleUrl(ctx.displayEvent)
  const title = ctx.displayEvent.tags.find((tag) => tag[0] === 'title')?.[1]?.trim()
  const { t } = useTranslation()
  const line = title?.trim() || href?.trim() || t('Web bookmark')
  return <div className="min-w-0 truncate text-sm">{line}</div>
}

export const renderWikiPreviews = {
  article(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  },
  mergeRequest(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  },
  mergeAcceptance(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  },
  redirect(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  },
  nostrSpec(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  }
}

export const renderPublicationPreviews = {
  publication(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  },
  content(ctx: RenderCtx) {
    return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
  }
}

export function renderLongFormPreview(ctx: RenderCtx) {
  return <LongFormCard event={ctx.displayEvent} interactive={false} autoLoadMedia={ctx.autoLoadMedia} />
}

export function renderLiveEventPreview(ctx: RenderCtx) {
  return <LiveEventPreview event={ctx.displayEvent} />
}

export function renderGroupMetadataPreview(ctx: RenderCtx) {
  return <GroupMetadataPreview event={ctx.displayEvent} />
}

export const renderCommunityPreviews = (ctx: RenderCtx) => (
  <CommunityDefinitionPreview event={ctx.displayEvent} />
)

export function renderPollPreview(ctx: RenderCtx) {
  return <PollPreview event={ctx.displayEvent} hideOptions={ctx.hidePollOptions} />
}

export const renderMediaPreviews = {
  picture(ctx: RenderCtx) {
    return <PictureNotePreview event={ctx.displayEvent} />
  },
  video(ctx: RenderCtx) {
    return <VideoNotePreview event={ctx.displayEvent} />
  },
  music(ctx: RenderCtx) {
    return <MusicTrackNotePreview event={ctx.displayEvent} />
  }
}

export function renderRelayReviewPreview(ctx: RenderCtx) {
  return <NormalContentPreview event={ctx.displayEvent} />
}

/** Compact citation line for ContentPreview / embeds — not the full {@link CitationCard} body. */
export function renderCitationPreview(ctx: RenderCtx) {
  return (
    <div className={cn('min-w-0 line-clamp-2 text-sm text-muted-foreground')}>
      <CitationCard event={ctx.displayEvent} displayType="foot-end" />
    </div>
  )
}

export function renderCalendarPreviews(ctx: RenderCtx) {
  return (
    <CalendarEventContent event={ctx.displayEvent} showRsvp={false} showFull={false} className="text-sm" />
  )
}

export const renderPaymentPreviews = {
  zap(ctx: RenderCtx) {
    if (ctx.previewDensity === 'compact') {
      return <Zap event={ctx.displayEvent} />
    }
    return <ZapPreview event={ctx.displayEvent} />
  },
  superchat(ctx: RenderCtx) {
    if (ctx.previewDensity === 'compact') {
      return <Zap event={ctx.displayEvent} />
    }
    return <ZapPreview event={ctx.displayEvent} />
  },
  monero(ctx: RenderCtx) {
    if (ctx.previewDensity === 'compact') {
      return <MoneroTip event={ctx.displayEvent} />
    }
    return <MoneroTip event={ctx.displayEvent} variant="thread" />
  }
}

export function renderFollowPackPreview(ctx: RenderCtx) {
  return <FollowPackPreview event={ctx.displayEvent} />
}

export function renderGitRepublicPreviews(ctx: RenderCtx) {
  return <GitRepublicEventCard variant="compact" event={ctx.displayEvent} />
}

export function renderLearningResourcePreview(ctx: RenderCtx) {
  return <LearningResourceCard variant="compact" event={ctx.displayEvent} />
}

export const renderApplicationHandlerPreviews = {
  info(ctx: RenderCtx) {
    return <ApplicationHandlerInfo event={ctx.displayEvent} />
  },
  recommendation(ctx: RenderCtx) {
    return <ApplicationHandlerRecommendation event={ctx.displayEvent} />
  }
}

export function ReactionPreview({ ctx }: { ctx: RenderCtx }) {
  const { t } = useTranslation()
  const reactionDisplay = useNotificationReactionDisplay(ctx.event)
  return (
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
        <ReactionEmojiDisplay event={ctx.displayEvent} maxRawLength={24} variant="compact" />
      )}
      {t(notificationReactionSummaryKey(reactionDisplay))}
    </div>
  )
}

export const renderNotificationPreviews = {
  reaction(ctx: RenderCtx) {
    return <ReactionPreview ctx={ctx} />
  },
  pollResponse(_ctx: RenderCtx) {
    const { t } = useTranslation()
    return (
      <div className="pointer-events-none text-sm text-muted-foreground">
        {t('Notification poll vote summary')}
      </div>
    )
  }
}

export function renderRepostPreview(_ctx: RenderCtx) {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-none text-sm text-muted-foreground">{t('Notification boost summary')}</div>
  )
}
