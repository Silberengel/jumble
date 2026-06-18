import { describe, expect, it } from 'vitest'
import { computeComposerBlockReason } from './composer-block-reason'
import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

const baseInput = {
  canSignEvents: true,
  posting: false,
  uploadInProgress: false,
  text: 'hello',
  determinedKind: kinds.ShortTextNote,
  mediaNoteKind: null as number | null,
  mediaUrl: '',
  relayCapBlockInfo: null,
  isPoll: false,
  pollOptionCount: 0,
  isPublicMessage: false,
  extractedMentionCount: 0,
  isHighlight: false,
  highlightSourceEmpty: false,
  isCitationInternal: false,
  citationInternalCTag: '',
  isCitationExternal: false,
  citationExternalUrl: '',
  citationAccessedOn: '',
  isCitationHardcopy: false,
  isCitationPrompt: false,
  citationPromptLlm: '',
  isMusicTrack: false,
  musicTrackTitle: '',
  musicTrackAudioUrl: '',
  isDiscussionThread: false,
  hasParentEvent: false,
  threadTitle: '',
  threadTopicResolved: false,
  threadContentOk: false,
  additionalRelayCount: 1,
  threadIsReadingGroup: false,
  threadReadingAuthor: '',
  threadReadingSubject: ''
}

describe('computeComposerBlockReason', () => {
  it('returns null when publish is allowed', () => {
    expect(computeComposerBlockReason(baseInput)).toBeNull()
  })

  it('blocks empty short notes', () => {
    expect(computeComposerBlockReason({ ...baseInput, text: '   ' })).toBe('empty')
  })

  it('allows publish when editor has unsynced content', () => {
    expect(
      computeComposerBlockReason({
        ...baseInput,
        text: '',
        hasUnsyncedEditorContent: true
      })
    ).toBeNull()
  })

  it('blocks while posting', () => {
    expect(computeComposerBlockReason({ ...baseInput, posting: true })).toBe('posting')
  })

  it('blocks relay cap overflow', () => {
    expect(
      computeComposerBlockReason({
        ...baseInput,
        relayCapBlockInfo: { outboxSlotsInPublish: 2, selectedContacted: 18, selectedTotal: 22 }
      })
    ).toBe('relay_cap')
  })

  it('blocks public messages without recipients', () => {
    expect(
      computeComposerBlockReason({
        ...baseInput,
        isPublicMessage: true,
        determinedKind: ExtendedKind.PUBLIC_MESSAGE,
        extractedMentionCount: 0
      })
    ).toBe('public_message_recipients')
  })
})
