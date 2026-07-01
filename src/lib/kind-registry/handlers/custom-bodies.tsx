import { ExtendedKind, isMusicTrackKind, isNip71StyleVideoKind } from '@/constants'
import { getHttpUrlFromITags } from '@/lib/event'
import { getWebBookmarkReplaceableEventNaddr } from '@/lib/web-bookmark-nip'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import Highlight from '@/components/Note/Highlight'
import ShortNoteEditProposalNotificationCard from '@/components/Note/ShortNoteEditProposalNotificationCard'
import NotificationEventCard from '@/components/Note/NotificationEventCard'
import CommunityDefinition from '@/components/Note/CommunityDefinition'
import GroupMetadata from '@/components/Note/GroupMetadata'
import LiveEvent from '@/components/Note/LiveEvent'
import PublicationCard from '@/components/Note/PublicationCard'
import PublicationContentCard from '@/components/Note/PublicationContentCard'
import PublicationIndexMetadata from '@/components/Note/PublicationIndexMetadata'
import NostrSpecCard from '@/components/Note/NostrSpecCard'
import WikiCard from '@/components/Note/WikiCard'
import {
  WikiArticleCollabSection,
  WikiMergeAcceptanceCard,
  WikiMergeRequestCard,
  WikiRedirectCard
} from '@/components/Note/WikiCollabCards'
import LongFormCard from '@/components/Note/LongFormCard'
import PictureNote from '@/components/Note/PictureNote'
import Poll from '@/components/Note/Poll'
import AudioPlayer from '@/components/AudioPlayer'
import VideoNote from '@/components/Note/VideoNote'
import MusicTrackNote from '@/components/Note/MusicTrackNote'
import RelayReview from '@/components/Note/RelayReview'
import Superchat from '@/components/Note/Superchat'
import Zap from '@/components/Note/Zap'
import MoneroTip from '@/components/Note/MoneroTip'
import CitationCard from '@/components/CitationCard'
import FollowPackPreview from '@/components/ContentPreview/FollowPackPreview'
import CalendarEventContent from '@/components/CalendarEventContent'
import GitRepublicEventCard from '@/components/Note/GitRepublicEventCard'
import LearningResourceCard from '@/components/Note/LearningResourceCard'
import ApplicationHandlerInfo from '@/components/ApplicationHandlerInfo'
import ApplicationHandlerRecommendation from '@/components/ApplicationHandlerRecommendation'
import {
  bodyClass,
  EmbeddedNote,
  HttpUrlOpenGraphOrLink,
  renderMarkdownContent,
  RepostEventContent
} from '../content-renderers'
import type { RenderCtx } from '../types'

export function renderShortNoteEditBody(ctx: RenderCtx) {
  return <ShortNoteEditProposalNotificationCard className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderTextContentBody(ctx: RenderCtx) {
  return renderMarkdownContent(ctx, bodyClass(ctx))
}

export function renderDiscussionBody(ctx: RenderCtx) {
  const titleTag = ctx.displayEvent.tags.find((tag) => tag[0] === 'title')
  const title = titleTag?.[1] || 'Untitled Discussion'
  return (
    <>
      <h3 className="mt-2 text-lg font-semibold leading-tight break-words">{title}</h3>
      {renderMarkdownContent({ ...ctx, hideMetadata: true }, bodyClass(ctx))}
    </>
  )
}

export function renderRepostBody(ctx: RenderCtx) {
  return <RepostEventContent className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderHighlightBody(ctx: RenderCtx) {
  return <Highlight className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderWebBookmarkBody(ctx: RenderCtx) {
  const { displayEvent, event } = ctx
  const embeddedNaddr = getWebBookmarkReplaceableEventNaddr(displayEvent)
  const href = getWebBookmarkArticleUrl(displayEvent)
  const title = displayEvent.tags.find((tag) => tag[0] === 'title')?.[1]?.trim()
  const description = displayEvent.content?.trim()
  return (
    <>
      {title ? (
        <h3 className="mt-2 text-base font-semibold leading-snug break-words">{title}</h3>
      ) : null}
      {embeddedNaddr ? (
        <EmbeddedNote
          noteId={embeddedNaddr}
          className="mt-2"
          containingEvent={event}
          showFull={false}
        />
      ) : href ? (
        <div className="mt-2 not-prose max-w-full">
          <HttpUrlOpenGraphOrLink url={href} containingEvent={event} block className="w-full" />
        </div>
      ) : null}
      {description ? (
        <p className="mt-2 text-base whitespace-pre-wrap break-words">{description}</p>
      ) : null}
    </>
  )
}

export const renderWikiBodies = {
  article(ctx: RenderCtx) {
    if (ctx.showFull) {
      return (
        <>
          <WikiArticleCollabSection event={ctx.displayEvent} />
          {renderMarkdownContent(ctx, bodyClass(ctx))}
        </>
      )
    }
    return <WikiCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  },
  mergeRequest(ctx: RenderCtx) {
    return (
      <WikiMergeRequestCard
        className={bodyClass(ctx)}
        event={ctx.displayEvent}
        showFull={ctx.showFull}
      />
    )
  },
  mergeAcceptance(ctx: RenderCtx) {
    return <WikiMergeAcceptanceCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  },
  redirect(ctx: RenderCtx) {
    return <WikiRedirectCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  },
  nostrSpec(ctx: RenderCtx) {
    if (ctx.showFull) {
      return renderMarkdownContent(ctx, bodyClass(ctx))
    }
    return <NostrSpecCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  }
}

export const renderPublicationBodies = {
  publication(ctx: RenderCtx) {
    if (ctx.showFull) {
      return <PublicationIndexMetadata className={bodyClass(ctx)} event={ctx.displayEvent} variant="full" />
    }
    return <PublicationCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  },
  content(ctx: RenderCtx) {
    return (
      <PublicationContentCard
        className={bodyClass(ctx)}
        event={ctx.displayEvent}
        variant={ctx.showFull ? 'full' : 'embed'}
        interactive={!ctx.showFull}
      />
    )
  }
}

export function renderLongFormBodies(ctx: RenderCtx) {
  if (ctx.showFull) {
    return renderMarkdownContent({ ...ctx, hideMetadata: true }, bodyClass(ctx))
  }
  return <LongFormCard className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderLiveEventBodies(ctx: RenderCtx) {
  return <LiveEvent className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderGroupMetadataBody(ctx: RenderCtx) {
  return (
    <GroupMetadata
      className={bodyClass(ctx)}
      event={ctx.displayEvent}
      originalNoteId={ctx.originalNoteId}
    />
  )
}

export const renderCommunityBodies = (ctx: RenderCtx) => (
  <CommunityDefinition className={bodyClass(ctx)} event={ctx.displayEvent} />
)

export function renderCitationBodies(ctx: RenderCtx) {
  return <CitationCard className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderPollBodies(ctx: RenderCtx) {
  return (
    <>
      {renderMarkdownContent({ ...ctx, hideMetadata: true }, bodyClass(ctx))}
      <Poll
        className="mt-2"
        event={ctx.displayEvent}
        eagerFetchResults={Boolean(ctx.embedded)}
        hidePollOptions={ctx.hidePollOptions}
      />
    </>
  )
}

export const renderMediaBodies = {
  picture(ctx: RenderCtx) {
    return <PictureNote className={bodyClass(ctx)} event={ctx.event} />
  },
  video(ctx: RenderCtx) {
    return <VideoNote className={bodyClass(ctx)} event={ctx.event} loadMedia={ctx.showFull} />
  },
  music(ctx: RenderCtx) {
    return <MusicTrackNote className={bodyClass(ctx)} event={ctx.event} loadMedia={ctx.showFull} />
  }
}

export function renderRelayReviewBody(ctx: RenderCtx) {
  return <RelayReview className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderCalendarBodies(ctx: RenderCtx) {
  return (
    <CalendarEventContent
      event={ctx.displayEvent}
      className={bodyClass(ctx)}
      showRsvp
      showFull={ctx.showFull}
    />
  )
}

export const renderPaymentBodies = {
  zap(ctx: RenderCtx) {
    return (
      <Zap
        className={bodyClass(ctx)}
        event={ctx.displayEvent}
        variant={ctx.showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  },
  superchat(ctx: RenderCtx) {
    return (
      <Superchat
        className={bodyClass(ctx)}
        event={ctx.displayEvent}
        variant={ctx.showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  },
  monero(ctx: RenderCtx) {
    return (
      <MoneroTip
        className={bodyClass(ctx)}
        event={ctx.displayEvent}
        variant={ctx.showPaymentAttestationAction ? 'notification' : 'thread'}
      />
    )
  }
}

export function renderFollowPackBody(ctx: RenderCtx) {
  return <FollowPackPreview className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderGitRepublicBodies(ctx: RenderCtx) {
  return <GitRepublicEventCard className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export function renderLearningResourceBody(ctx: RenderCtx) {
  return <LearningResourceCard className={bodyClass(ctx)} event={ctx.displayEvent} />
}

export const renderApplicationHandlerBodies = {
  info(ctx: RenderCtx) {
    return <ApplicationHandlerInfo event={ctx.displayEvent} />
  },
  recommendation(ctx: RenderCtx) {
    return <ApplicationHandlerRecommendation event={ctx.displayEvent} />
  }
}

export const renderNotificationBodies = {
  pollResponse(ctx: RenderCtx) {
    return <NotificationEventCard className={bodyClass(ctx)} event={ctx.displayEvent} />
  }
}

export function renderVoiceBody(ctx: RenderCtx) {
  return <AudioPlayer className={bodyClass(ctx)} src={ctx.event.content} />
}

export function renderVoiceCommentBody(ctx: RenderCtx) {
  const voiceArticleUrl = getHttpUrlFromITags(ctx.event)
  return (
    <>
      {voiceArticleUrl ? (
        <div className="mt-2 not-prose max-w-full">
          <HttpUrlOpenGraphOrLink
            url={voiceArticleUrl}
            containingEvent={ctx.event}
            block
            className="w-full"
          />
        </div>
      ) : null}
      <AudioPlayer className={bodyClass(ctx)} src={ctx.event.content} />
    </>
  )
}

export function resolveMediaBody(ctx: RenderCtx) {
  if (ctx.event.kind === ExtendedKind.PICTURE) return renderMediaBodies.picture(ctx)
  if (isNip71StyleVideoKind(ctx.event.kind)) return renderMediaBodies.video(ctx)
  if (isMusicTrackKind(ctx.event.kind)) return renderMediaBodies.music(ctx)
  if (ctx.event.kind === ExtendedKind.VOICE) return renderVoiceBody(ctx)
  if (ctx.event.kind === ExtendedKind.VOICE_COMMENT) return renderVoiceCommentBody(ctx)
  return null
}
