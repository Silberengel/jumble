import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

/** Human-readable label for a Nostr event kind (link previews, note page titles). */
export function getEventTypeName(kind: number): string {
  switch (kind) {
    case kinds.ShortTextNote:
      return 'Text Post'
    case kinds.LongFormArticle:
      return 'Longform Article'
    case ExtendedKind.PICTURE:
      return 'Picture'
    case ExtendedKind.VIDEO:
    case ExtendedKind.VIDEO_ADDRESSABLE:
      return 'Video'
    case ExtendedKind.SHORT_VIDEO:
      return 'Short Video'
    case ExtendedKind.POLL:
      return 'Poll'
    case ExtendedKind.COMMENT:
      return 'Comment'
    case ExtendedKind.VOICE:
      return 'Voice Post'
    case ExtendedKind.MUSIC_TRACK:
      return 'Music Track'
    case ExtendedKind.VOICE_COMMENT:
      return 'Voice Comment'
    case kinds.Highlights:
      return 'Highlight'
    case ExtendedKind.PUBLICATION:
      return 'Publication'
    case ExtendedKind.PUBLICATION_CONTENT:
      return 'Publication Content'
    case ExtendedKind.WIKI_ARTICLE:
      return 'Wiki Article'
    case ExtendedKind.WIKI_MERGE_REQUEST:
      return 'Wiki Merge Request'
    case ExtendedKind.WIKI_MERGE_ACCEPTANCE:
      return 'Wiki Merge Acceptance'
    case ExtendedKind.WIKI_REDIRECT:
      return 'Wiki Redirect'
    case ExtendedKind.NOSTR_SPECIFICATION:
      return 'Nostr Specification'
    case ExtendedKind.DISCUSSION:
      return 'Discussion'
    case ExtendedKind.CALENDAR_EVENT_TIME:
    case ExtendedKind.CALENDAR_EVENT_DATE:
      return 'Calendar Event'
    default:
      return `Event (kind ${kind})`
  }
}
