import type { TFeedSubRequest } from '@/types'
import type { Filter } from 'nostr-tools'

export type NoteListTimelineRequestOptions = {
  defaultKinds: readonly number[]
  seeAllFeedEvents: boolean
  useFilterAsIs: boolean
  areAlgoRelays: boolean
  allowKindlessRelayExplore: boolean
  clientSideKindFilter: boolean
  limit: number
  algoLimit: number
  relayExploreLimit: number
}

export function mapNoteListSubRequestsForTimeline(
  requests: readonly TFeedSubRequest[],
  options: NoteListTimelineRequestOptions
): TFeedSubRequest[] {
  const seeAllNoSpell = options.seeAllFeedEvents && !options.useFilterAsIs
  return requests.map(({ urls, filter }) => {
    const baseLimit = filter.limit ?? (options.areAlgoRelays ? options.algoLimit : options.limit)
    if (options.useFilterAsIs) {
      const hasKindsInRequest = Array.isArray(filter.kinds) && filter.kinds.length > 0
      if (options.allowKindlessRelayExplore && urls.length === 1 && !hasKindsInRequest) {
        const finalFilter: Filter = {
          ...filter,
          limit: filter.limit ?? options.relayExploreLimit
        }
        delete finalFilter.kinds
        return { urls, filter: finalFilter }
      }
      const finalFilter: Filter = { ...filter, limit: baseLimit }
      if (options.clientSideKindFilter) {
        if (hasKindsInRequest) {
          finalFilter.kinds = filter.kinds
        } else {
          delete finalFilter.kinds
        }
      } else if (hasKindsInRequest) {
        finalFilter.kinds = filter.kinds
      } else {
        finalFilter.kinds = [...options.defaultKinds]
      }
      return { urls, filter: finalFilter }
    }
    if (seeAllNoSpell) {
      const { kinds: _omitKinds, ...rest } = filter
      return {
        urls,
        filter: {
          ...rest,
          limit: options.areAlgoRelays ? options.algoLimit : options.limit
        }
      }
    }
    return {
      urls,
      filter: {
        ...filter,
        kinds: [...options.defaultKinds],
        limit: options.areAlgoRelays ? options.algoLimit : options.limit
      }
    }
  })
}
