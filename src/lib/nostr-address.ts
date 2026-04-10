/**
 * Utility functions for handling nostr addresses
 */

/**
 * Regex pattern for matching nostr addresses that don't already have a prefix
 * Matches npub, nprofile, note, nevent, naddr, nrelay patterns
 */
const NOSTR_ADDRESS_REGEX = /\b(npub|nprofile|note|nevent|naddr|nrelay)1[a-z0-9]+/gi

/**
 * Prefixes nostr addresses with "nostr:" if they don't already have a prefix
 * @param content - The content to process
 * @returns The content with nostr addresses properly prefixed
 */
export function prefixNostrAddresses(content: string): string {
  return content.replace(NOSTR_ADDRESS_REGEX, (match, _p1, offset) => {
    // Check if it already has a prefix (nostr: or other protocol)
    // Look at the characters immediately before this specific match
    const beforeMatch = content.substring(0, offset)
    
    // Check if the match is already prefixed with "nostr:"
    if (beforeMatch.endsWith('nostr:')) {
      return match
    }
    
    // Check if the match is prefixed with @ (for @mention style)
    if (beforeMatch.endsWith('@')) {
      return match
    }
    
    // Check if the match is within a URL by looking for common URL patterns before it
    // This includes http://, https://, and common URL characters like /, ?, #
    const urlPattern = /(https?:\/\/|www\.|\/[^/]*|\?[^=]*=|#[^/]*\/)$/
    if (urlPattern.test(beforeMatch)) {
      return match
    }
    
    // Also check if the match is followed by URL-like characters
    const afterMatch = content.substring(offset + match.length)
    const urlSuffixPattern = /^(\/|\.|\?|#|&|%|\s|$)/
    if (!urlSuffixPattern.test(afterMatch)) {
      // If it's not followed by URL characters, it might be within a URL
      return match
    }
    
    // Add nostr: prefix
    return `nostr:${match}`
  })
}
