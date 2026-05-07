import {
  decodeFollowSetSpellId,
  encodeFollowSetSpellId,
  getFollowSetDTag,
  isFollowSetSpellId,
  labelFollowSetEvent
} from '@/lib/follow-set-spell'
import { FAUX_SPELL_ORDER } from '@/constants'
import {
  Bell,
  Bookmark,
  CalendarDays,
  Flame,
  Map as MapIcon,
  Gift,
  Hash,
  Image as ImageIcon,
  MessageSquare,
  Users,
  type LucideIcon
} from 'lucide-react'

export type FauxSpellName = (typeof FAUX_SPELL_ORDER)[number]

export function isBuiltinFauxSpell(s: string): s is FauxSpellName {
  return (FAUX_SPELL_ORDER as readonly string[]).includes(s)
}

/** URL / picker param: built-in faux name or encoded follow-set spell id. */
export function isFauxSpellPageParam(s: string): boolean {
  if (isBuiltinFauxSpell(s)) return true
  if (!isFollowSetSpellId(s)) return false
  return decodeFollowSetSpellId(s) != null
}

export function isFollowFeedFauxSpellId(s: string | null): boolean {
  return s === 'following' || (!!s && isFollowSetSpellId(s))
}

export function fauxSpellLabelKey(name: FauxSpellName): string {
  switch (name) {
    case 'notifications':
      return 'Notifications'
    case 'discussions':
      return 'Discussions'
    case 'following':
      return 'Following'
    case 'heatMap':
      return 'Heat map'
    case 'topicMap':
      return 'Topic map'
    case 'followPacks':
      return 'Follow Packs'
    case 'media':
      return 'Media'
    case 'interests':
      return 'Interests'
    case 'bookmarks':
      return 'Bookmarks'
    case 'calendar':
      return 'Calendar'
    default:
      return 'Spells'
  }
}

export const FAUX_SPELL_ICON: Record<FauxSpellName, LucideIcon> = {
  notifications: Bell,
  discussions: MessageSquare,
  following: Users,
  heatMap: Flame,
  topicMap: MapIcon,
  followPacks: Gift,
  media: ImageIcon,
  interests: Hash,
  bookmarks: Bookmark,
  calendar: CalendarDays
}

/** Lucide icon for a follow-set row (indented under Following). */
export const FOLLOW_SET_SPELL_ROW_ICON = Users

/** Follow-set rows + URL segments */
export {
  decodeFollowSetSpellId,
  encodeFollowSetSpellId,
  getFollowSetDTag,
  isFollowSetSpellId,
  labelFollowSetEvent
}
