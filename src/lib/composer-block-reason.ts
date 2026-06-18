import type { TPrePublishRelayCapPreview } from '@/lib/pre-publish-relay-cap'
import { publishRequiresNonemptyContent } from '@/lib/publish-content-required'
import { ExtendedKind, MAX_PUBLISH_RELAYS } from '@/constants'
import type { TFunction } from 'i18next'

export type ComposerBlockReason =
  | 'read_only'
  | 'posting'
  | 'uploading'
  | 'empty'
  | 'relay_cap'
  | 'poll_options'
  | 'public_message_recipients'
  | 'highlight_source'
  | 'citation_fields'
  | 'music_track_fields'
  | 'discussion_fields'
  | null

export type ComposerBlockReasonInput = {
  canSignEvents: boolean
  posting: boolean
  uploadInProgress: boolean
  text: string
  determinedKind: number
  mediaNoteKind: number | null
  mediaUrl: string
  relayCapBlockInfo: {
    outboxSlotsInPublish: number
    selectedContacted: number
    selectedTotal: number
  } | null
  isPoll: boolean
  pollOptionCount: number
  isPublicMessage: boolean
  extractedMentionCount: number
  parentEventKind?: number
  isHighlight: boolean
  highlightSourceEmpty: boolean
  isCitationInternal: boolean
  citationInternalCTag: string
  isCitationExternal: boolean
  citationExternalUrl: string
  citationAccessedOn: string
  isCitationHardcopy: boolean
  isCitationPrompt: boolean
  citationPromptLlm: string
  isMusicTrack: boolean
  musicTrackTitle: string
  musicTrackAudioUrl: string
  isDiscussionThread: boolean
  hasParentEvent: boolean
  threadTitle: string
  threadTopicResolved: boolean
  threadContentOk: boolean
  additionalRelayCount: number
  threadIsReadingGroup: boolean
  threadReadingAuthor: string
  threadReadingSubject: string
}

export function computeComposerBlockReason(input: ComposerBlockReasonInput): ComposerBlockReason {
  if (!input.canSignEvents) return 'read_only'
  if (input.posting) return 'posting'
  if (input.uploadInProgress) return 'uploading'
  if (input.relayCapBlockInfo != null) return 'relay_cap'

  if (input.isDiscussionThread && !input.hasParentEvent) {
    if (
      !input.threadTitle.trim() ||
      input.threadTitle.length > 100 ||
      !input.threadTopicResolved ||
      !input.threadContentOk ||
      input.additionalRelayCount === 0 ||
      (input.threadIsReadingGroup &&
        (!input.threadReadingAuthor.trim() || !input.threadReadingSubject.trim()))
    ) {
      return 'discussion_fields'
    }
  }

  const requiresNonemptyContent = publishRequiresNonemptyContent(input.determinedKind)
  const hasNonemptyContent = input.text.trim().length > 0
  const contentOk = requiresNonemptyContent
    ? hasNonemptyContent
    : (input.mediaNoteKind !== null && !!input.mediaUrl) || hasNonemptyContent
  if (!contentOk) return 'empty'

  if (input.isPoll && input.pollOptionCount < 2) return 'poll_options'
  if (
    input.isPublicMessage &&
    input.extractedMentionCount === 0 &&
    input.parentEventKind !== ExtendedKind.PUBLIC_MESSAGE
  ) {
    return 'public_message_recipients'
  }
  if (input.isHighlight && input.highlightSourceEmpty) return 'highlight_source'
  if (input.isCitationInternal && !input.citationInternalCTag.trim()) return 'citation_fields'
  if (
    input.isCitationExternal &&
    (!input.citationExternalUrl.trim() || !input.citationAccessedOn.trim())
  ) {
    return 'citation_fields'
  }
  if (input.isCitationHardcopy && !input.citationAccessedOn.trim()) return 'citation_fields'
  if (
    input.isCitationPrompt &&
    (!input.citationPromptLlm.trim() || !input.citationAccessedOn.trim())
  ) {
    return 'citation_fields'
  }
  if (
    input.isMusicTrack &&
    (!input.musicTrackTitle.trim() || !input.musicTrackAudioUrl.trim())
  ) {
    return 'music_track_fields'
  }

  return null
}

export function relayCapPreviewToBlockInfo(
  preview: TPrePublishRelayCapPreview | null
): ComposerBlockReasonInput['relayCapBlockInfo'] {
  if (!preview?.blocksPublish) return null
  return {
    outboxSlotsInPublish: preview.outboxSlotsInPublish,
    selectedContacted: preview.selectedContacted,
    selectedTotal: preview.selectedTotal
  }
}

/** User-visible message for a block reason (including relay-cap detail). */
export function formatComposerBlockMessage(
  reason: ComposerBlockReason,
  relayCapBlockInfo: ComposerBlockReasonInput['relayCapBlockInfo'],
  t: TFunction
): string | null {
  if (reason === 'relay_cap' && relayCapBlockInfo) {
    return relayCapBlockInfo.outboxSlotsInPublish > 0
      ? t('Publish relay cap hint with outbox first', {
          max: MAX_PUBLISH_RELAYS,
          reservedSlots: relayCapBlockInfo.outboxSlotsInPublish,
          selected: relayCapBlockInfo.selectedTotal,
          selectedContacted: relayCapBlockInfo.selectedContacted
        })
      : t('Publish relay cap hint', {
          max: MAX_PUBLISH_RELAYS,
          selected: relayCapBlockInfo.selectedTotal,
          selectedContacted: relayCapBlockInfo.selectedContacted
        })
  }
  const key = composerBlockReasonMessageKey(reason)
  return key ? t(key) : null
}

/** i18n keys for {@link ComposerBlockReason}. */
export function composerBlockReasonMessageKey(
  reason: ComposerBlockReason
): string | null {
  switch (reason) {
    case 'read_only':
      return 'readOnlySession.cannotPublish'
    case 'posting':
      return 'Publishing...'
    case 'uploading':
      return 'Uploading...'
    case 'empty':
      return 'Write something...'
    case 'relay_cap':
      return 'Publish relay cap hint'
    case 'poll_options':
      return 'Add at least two poll options'
    case 'public_message_recipients':
      return 'Add recipients using nostr: mentions (e.g., nostr:npub1...) or open Advanced'
    case 'highlight_source':
      return 'Highlight source is required'
    case 'citation_fields':
      return 'Fill required citation fields'
    case 'music_track_fields':
      return 'Music track title and audio URL are required'
    case 'discussion_fields':
      return 'Fill required discussion thread fields'
    default:
      return null
  }
}
