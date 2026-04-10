import { HASHTAG_REGEX } from '@/constants'
import { NostrEvent } from 'nostr-tools'

/**
 * Normalize a hashtag/topic string
 * @param text The text to normalize
 * @param replaceSpaces Whether to replace spaces with hyphens (true for t-tags, false for content hashtags)
 * @returns Normalized string (lowercase, filtered characters, singular form)
 */
export function normalizeHashtag(text: string, replaceSpaces: boolean = true): string {
  // Convert to lowercase and optionally replace spaces with hyphens
  let normalized = text.toLowerCase()
  if (replaceSpaces) {
    normalized = normalized.replace(/\s+/g, '-')
  }
  
  // Only allow letters, numbers, hyphens, and underscores
  normalized = normalized.replace(/[^a-z0-9_-]/g, '')
  
  // Clean up multiple consecutive hyphens/underscores
  normalized = normalized.replace(/[-_]+/g, '-')
  
  // Remove leading/trailing hyphens/underscores
  normalized = normalized.replace(/^[-_]+|[-_]+$/g, '')
  
  // Reject hashtags that are only numbers
  if (/^[0-9]+$/.test(normalized)) {
    return ''
  }
  
  // Reject empty strings
  if (!normalized) {
    return ''
  }
  
  // Convert plural to singular (simple English plurals)
  // Handle common cases: -ies -> -y, -es -> (sometimes), -s -> remove
  if (normalized.endsWith('ies') && normalized.length > 4) {
    // cities -> city, berries -> berry
    normalized = normalized.slice(0, -3) + 'y'
  } else if (normalized.endsWith('ses') && normalized.length > 4) {
    // classes -> class, bosses -> boss
    normalized = normalized.slice(0, -2)
  } else if (normalized.endsWith('xes') && normalized.length > 4) {
    // boxes -> box
    normalized = normalized.slice(0, -2)
  } else if (normalized.endsWith('ches') && normalized.length > 5) {
    // churches -> church
    normalized = normalized.slice(0, -2)
  } else if (normalized.endsWith('s') && normalized.length > 2) {
    // Simple plural: cats -> cat, bitcoins -> bitcoin, Christians -> Christian
    // But avoid removing 's' from words that naturally end in 's'
    // Check if second-to-last character is not 's' to avoid "ss" words
    const secondLast = normalized[normalized.length - 2]
    if (secondLast !== 's') {
      normalized = normalized.slice(0, -1)
    }
  }
  
  return normalized
}

/**
 * Normalize a topic string (t-tags) - replaces spaces with hyphens
 * Alias for normalizeHashtag with replaceSpaces=true
 */
export function normalizeTopic(topic: string): string {
  return normalizeHashtag(topic, true)
}

/**
 * Extract hashtags from content
 */
export function extractHashtagsFromContent(content: string): string[] {
  const matches = content.matchAll(HASHTAG_REGEX)
  const hashtags: string[] = []
  
  for (const match of matches) {
    // Remove the # prefix and normalize
    const tag = match[0].substring(1)
    hashtags.push(normalizeTopic(tag))
  }
  
  return hashtags
}

/**
 * Extract h-tag (group ID) from event tags
 */
function extractHTagFromEvent(event: NostrEvent): string | null {
  const hTag = event.tags.find(tag => tag[0] === 'h' && tag[1])
  return hTag ? hTag[1] : null
}

/**
 * Parse group identifier from h-tag and relay sources
 * Supports both "relay'group-id" format and bare group IDs
 */
function parseGroupIdentifier(
  hTag: string, 
  relaySources: string[]
): { groupId: string; groupRelay: string | null; fullIdentifier: string } {
  // Check if h-tag already contains relay'group-id format
  if (hTag.includes("'")) {
    const [relay, groupId] = hTag.split("'", 2)
    return {
      groupId,
      groupRelay: relay,
      fullIdentifier: hTag
    }
  }
  
  // For bare group IDs, use the first relay source
  const groupRelay = relaySources.length > 0 ? relaySources[0] : null
  const fullIdentifier = groupRelay ? `${groupRelay}'${hTag}` : hTag
  
  return {
    groupId: hTag,
    groupRelay,
    fullIdentifier
  }
}

/**
 * Build display name for a group
 */
function buildGroupDisplayName(
  groupId: string,
  groupRelay: string | null
): string {
  let displayName: string
  
  if (!groupRelay) {
    displayName = groupId
  } else {
    // Extract hostname from relay URL for cleaner display
    try {
      const url = new URL(groupRelay)
      const hostname = url.hostname
      displayName = `${hostname}'${groupId}`
    } catch {
      // Fallback to full relay URL if parsing fails
      displayName = `${groupRelay}'${groupId}`
    }
  }
  
  // Truncate to 20 characters
  return displayName.length > 20 ? displayName.substring(0, 20) : displayName
}

/**
 * Extract group information from event
 */
export function extractGroupInfo(
  event: NostrEvent,
  relaySources: string[]
): { groupId: string | null; groupRelay: string | null; groupDisplayName: string | null; isGroupDiscussion: boolean } {
  const hTag = extractHTagFromEvent(event)
  
  if (!hTag) {
    return {
      groupId: null,
      groupRelay: null,
      groupDisplayName: null,
      isGroupDiscussion: false
    }
  }
  
  const { groupId, groupRelay } = parseGroupIdentifier(hTag, relaySources)
  const groupDisplayName = buildGroupDisplayName(groupId, groupRelay)
  
  return {
    groupId,
    groupRelay,
    groupDisplayName,
    isGroupDiscussion: true
  }
}

