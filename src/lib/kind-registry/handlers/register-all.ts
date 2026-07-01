import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'
import type { KindHandler } from '../types'
import {
  renderApplicationHandlerBodies,
  renderCalendarBodies,
  renderCitationBodies,
  renderDiscussionBody,
  renderGitRepublicBodies,
  renderHighlightBody,
  renderLiveEventBodies,
  renderLongFormBodies,
  renderMediaBodies,
  renderNotificationBodies,
  renderPaymentBodies,
  renderPollBodies,
  renderPublicationBodies,
  renderRelayReviewBody,
  renderRepostBody,
  renderShortNoteEditBody,
  renderTextContentBody,
  renderWebBookmarkBody,
  renderWikiBodies,
  renderCommunityBodies,
  renderFollowPackBody,
  renderLearningResourceBody,
  renderGroupMetadataBody,
  renderVoiceBody,
  renderVoiceCommentBody
} from './custom-bodies'
import {
  renderApplicationHandlerPreviews,
  renderCalendarPreviews,
  renderDiscussionPreview,
  renderGitRepublicPreviews,
  renderHighlightPreview,
  renderLiveEventPreview,
  renderLongFormPreview,
  renderMediaPreviews,
  renderNotificationPreviews,
  renderPaymentPreviews,
  renderPollPreview,
  renderPublicationPreviews,
  renderRelayReviewPreview,
  renderRepostPreview,
  renderTextContentPreview,
  renderWebBookmarkPreview,
  renderWikiPreviews,
  renderCommunityPreviews,
  renderFollowPackPreview,
  renderLearningResourcePreview,
  renderGroupMetadataPreview,
  renderCitationPreview
} from './custom-previews'
import {
  renderNotificationBlurbs,
  renderPollBlurb,
  renderReactionBlurb,
  renderRepostBlurb,
  renderTextBlurb
} from './custom-blurbs'
import { citationManifests, groupMetadataManifest } from './manifests'
import { registerKindHandler, registerFallbackHandler } from '../registry'

const DEFAULT_ACTIONS = ['reply', 'repost', 'like', 'zap'] as const

function textHandler(kindsList: readonly number[], highlightable = false): KindHandler {
  return {
    kinds: kindsList,
    renderable: true,
    highlightable,
    actions: DEFAULT_ACTIONS,
    typeName: 'Text Post',
    render: renderTextContentBody,
    renderPreview: renderTextContentPreview,
    renderBlurb: renderTextBlurb
  }
}

export function registerAllKindHandlers(): void {
  registerKindHandler({
    kinds: [ExtendedKind.SHORT_NOTE_EDIT],
    renderable: true,
    render: renderShortNoteEditBody,
    typeName: 'Short Note Edit'
  })

  registerKindHandler(textHandler([kinds.ShortTextNote, ExtendedKind.COMMENT], true))
  registerKindHandler(textHandler([ExtendedKind.PUBLIC_MESSAGE]))

  registerKindHandler({
    kinds: [ExtendedKind.VOICE],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Voice Post',
    render: renderVoiceBody,
    renderPreview: renderTextContentPreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.VOICE_COMMENT],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Voice Comment',
    render: renderVoiceCommentBody,
    renderPreview: renderTextContentPreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.DISCUSSION],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: ['reply', 'like'],
    typeName: 'Discussion',
    render: renderDiscussionBody,
    renderPreview: renderDiscussionPreview,
    renderBlurb: renderTextBlurb
  })

  registerKindHandler({
    kinds: [kinds.Repost, ExtendedKind.GENERIC_REPOST],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Boost',
    render: renderRepostBody,
    renderPreview: renderRepostPreview,
    renderBlurb: renderRepostBlurb
  })

  registerKindHandler({
    kinds: [kinds.Reaction, ExtendedKind.EXTERNAL_REACTION],
    renderable: true,
    hideBody: true,
    actions: ['like'],
    typeName: 'Reaction',
    render: () => null,
    renderPreview: renderNotificationPreviews.reaction,
    renderBlurb: renderReactionBlurb
  })

  registerKindHandler({
    kinds: [ExtendedKind.POLL_RESPONSE],
    renderable: true,
    typeName: 'Poll Response',
    render: renderNotificationBodies.pollResponse,
    renderPreview: renderNotificationPreviews.pollResponse,
    renderBlurb: renderNotificationBlurbs.pollResponse
  })

  registerKindHandler({
    kinds: [kinds.Highlights],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Highlight',
    render: renderHighlightBody,
    renderPreview: renderHighlightPreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.WEB_BOOKMARK],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Web Bookmark',
    render: renderWebBookmarkBody,
    renderPreview: renderWebBookmarkPreview,
    renderBlurb: renderTextBlurb
  })

  registerKindHandler({
    kinds: [ExtendedKind.WIKI_ARTICLE],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Wiki Article',
    render: renderWikiBodies.article,
    renderPreview: renderWikiPreviews.article
  })

  registerKindHandler({
    kinds: [ExtendedKind.WIKI_MERGE_REQUEST],
    renderable: true,
    typeName: 'Wiki Merge Request',
    render: renderWikiBodies.mergeRequest,
    renderPreview: renderWikiPreviews.mergeRequest
  })

  registerKindHandler({
    kinds: [ExtendedKind.WIKI_MERGE_ACCEPTANCE],
    renderable: true,
    typeName: 'Wiki Merge Acceptance',
    render: renderWikiBodies.mergeAcceptance,
    renderPreview: renderWikiPreviews.mergeAcceptance
  })

  registerKindHandler({
    kinds: [ExtendedKind.WIKI_REDIRECT],
    renderable: true,
    typeName: 'Wiki Redirect',
    render: renderWikiBodies.redirect,
    renderPreview: renderWikiPreviews.redirect
  })

  registerKindHandler({
    kinds: [ExtendedKind.NOSTR_SPECIFICATION],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Nostr Specification',
    render: renderWikiBodies.nostrSpec,
    renderPreview: renderWikiPreviews.nostrSpec
  })

  registerKindHandler({
    kinds: [ExtendedKind.PUBLICATION],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Publication',
    render: renderPublicationBodies.publication,
    renderPreview: renderPublicationPreviews.publication
  })

  registerKindHandler({
    kinds: [ExtendedKind.PUBLICATION_CONTENT],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Publication Content',
    render: renderPublicationBodies.content,
    renderPreview: renderPublicationPreviews.content
  })

  registerKindHandler({
    kinds: [kinds.LongFormArticle],
    renderable: true,
    highlightable: true,
    reader: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Longform Article',
    render: renderLongFormBodies,
    renderPreview: renderLongFormPreview
  })

  registerKindHandler({
    kinds: [kinds.LiveEvent, 30312, 30313],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Live Event',
    render: renderLiveEventBodies,
    renderPreview: renderLiveEventPreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.GROUP_METADATA],
    renderable: true,
    manifest: groupMetadataManifest,
    typeName: 'Group Metadata',
    render: renderGroupMetadataBody,
    renderPreview: renderGroupMetadataPreview
  })

  registerKindHandler({
    kinds: [kinds.CommunityDefinition],
    renderable: true,
    typeName: 'Community Definition',
    render: renderCommunityBodies,
    renderPreview: renderCommunityPreviews
  })

  for (const manifest of citationManifests) {
    registerKindHandler({
      kinds: manifest.kinds,
      renderable: true,
      manifest,
      typeName: 'Citation',
      render: renderCitationBodies,
      renderPreview: renderCitationPreview
    })
  }

  registerKindHandler({
    kinds: [ExtendedKind.POLL],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Poll',
    render: renderPollBodies,
    renderPreview: renderPollPreview,
    renderBlurb: renderPollBlurb
  })

  registerKindHandler({
    kinds: [ExtendedKind.PICTURE],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Picture',
    render: renderMediaBodies.picture,
    renderPreview: renderMediaPreviews.picture
  })

  registerKindHandler({
    kinds: [ExtendedKind.VIDEO, ExtendedKind.SHORT_VIDEO, ExtendedKind.VIDEO_ADDRESSABLE],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Video',
    render: renderMediaBodies.video,
    renderPreview: renderMediaPreviews.video
  })

  registerKindHandler({
    kinds: [ExtendedKind.MUSIC_TRACK],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Music Track',
    render: renderMediaBodies.music,
    renderPreview: renderMediaPreviews.music
  })

  registerKindHandler({
    kinds: [ExtendedKind.RELAY_REVIEW],
    renderable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Relay Review',
    render: renderRelayReviewBody,
    renderPreview: renderRelayReviewPreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
    renderable: true,
    highlightable: true,
    actions: DEFAULT_ACTIONS,
    typeName: 'Calendar Event',
    render: renderCalendarBodies,
    renderPreview: renderCalendarPreviews
  })

  registerKindHandler({
    kinds: [ExtendedKind.ZAP_REQUEST, ExtendedKind.ZAP_RECEIPT, kinds.Zap],
    renderable: true,
    typeName: 'Zap',
    render: renderPaymentBodies.zap,
    renderPreview: renderPaymentPreviews.zap
  })

  registerKindHandler({
    kinds: [ExtendedKind.PAYMENT_NOTIFICATION],
    renderable: true,
    typeName: 'Superchat',
    render: renderPaymentBodies.superchat,
    renderPreview: renderPaymentPreviews.superchat
  })

  registerKindHandler({
    kinds: [ExtendedKind.MONERO_TIP_DISCLOSURE, ExtendedKind.MONERO_TIP_RECEIPT],
    renderable: true,
    typeName: 'Monero Tip',
    render: renderPaymentBodies.monero,
    renderPreview: renderPaymentPreviews.monero
  })

  registerKindHandler({
    kinds: [ExtendedKind.FOLLOW_PACK],
    renderable: true,
    typeName: 'Follow Pack',
    render: renderFollowPackBody,
    renderPreview: renderFollowPackPreview
  })

  registerKindHandler({
    kinds: [
      ExtendedKind.GIT_REPO_ANNOUNCEMENT,
      ExtendedKind.GIT_ISSUE,
      ExtendedKind.GIT_RELEASE
    ],
    renderable: true,
    typeName: 'Git Republic',
    render: renderGitRepublicBodies,
    renderPreview: renderGitRepublicPreviews
  })

  registerKindHandler({
    kinds: [ExtendedKind.LEARNING_RESOURCE],
    renderable: true,
    typeName: 'Learning Resource',
    render: renderLearningResourceBody,
    renderPreview: renderLearningResourcePreview
  })

  registerKindHandler({
    kinds: [ExtendedKind.APPLICATION_HANDLER_INFO],
    renderable: true,
    typeName: 'Application Handler',
    render: renderApplicationHandlerBodies.info,
    renderPreview: renderApplicationHandlerPreviews.info
  })

  registerKindHandler({
    kinds: [ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION],
    renderable: true,
    typeName: 'Application Handler Recommendation',
    render: renderApplicationHandlerBodies.recommendation,
    renderPreview: renderApplicationHandlerPreviews.recommendation
  })

  registerFallbackHandler({
    kinds: [],
    renderable: false,
    render: undefined,
    typeName: undefined
  })
}
