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
  FileText,
  Gift,
  Hash,
  Image as ImageIcon,
  MessageSquare,
  Users,
  type LucideIcon
} from 'lucide-react'

export type FauxSpellName = (typeof FAUX_SPELL_ORDER)[number]

const PROFILE_INTERACTIONS_SPELL_PREFIX = 'profileInteractions:'

export function encodeProfileInteractionsSpellId(pubkey: string): string {
  return `${PROFILE_INTERACTIONS_SPELL_PREFIX}${pubkey.trim().toLowerCase()}`
}

export function decodeProfileInteractionsSpellId(spellId: string | null | undefined): string | null {
  const raw = spellId?.trim()
  if (!raw?.startsWith(PROFILE_INTERACTIONS_SPELL_PREFIX)) return null
  const pubkey = raw.slice(PROFILE_INTERACTIONS_SPELL_PREFIX.length).trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null
}

export function isProfileInteractionsSpellId(spellId: string | null | undefined): boolean {
  return decodeProfileInteractionsSpellId(spellId) != null
}

export function isBuiltinFauxSpell(s: string): s is FauxSpellName {
  return (FAUX_SPELL_ORDER as readonly string[]).includes(s)
}

/** URL / picker param: built-in faux name or encoded follow-set spell id. */
export function isFauxSpellPageParam(s: string): boolean {
  if (isBuiltinFauxSpell(s)) return true
  if (isProfileInteractionsSpellId(s)) return true
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
    case 'followPacks':
      return 'Follow Packs'
    case 'media':
      return 'Media'
    case 'interests':
      return 'Interests'
    case 'nostrSpecs':
      return 'Nostr specs'
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
  followPacks: Gift,
  media: ImageIcon,
  interests: Hash,
  nostrSpecs: FileText,
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
