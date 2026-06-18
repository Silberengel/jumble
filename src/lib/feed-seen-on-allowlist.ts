import { uniqueRelayUrlsFromSubRequests } from '@/lib/feed-relay-urls'
import type { TFeedSubRequest } from '@/types'

/** Deduped relay URLs from one or more timeline subrequest stacks (feed stats + ⋯ menu “Seen on”). */
export function feedSeenOnAllowlistFromSubRequests(
  ...requestGroups: readonly (readonly TFeedSubRequest[] | undefined)[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of requestGroups) {
    if (!group?.length) continue
    for (const url of uniqueRelayUrlsFromSubRequests(group)) {
      const key = url.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(url)
    }
  }
  return out
}
