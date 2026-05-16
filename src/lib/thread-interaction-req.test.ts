import { ExtendedKind } from '@/constants'
import { buildThreadInteractionFilters } from '@/lib/thread-interaction-req'
import { kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

const ROOT_HEX = 'a'.repeat(64)
const SNAP_HEX = 'b'.repeat(64)

describe('buildThreadInteractionFilters', () => {
  it('merges E-root thread filters into few tag-scoped REQs', () => {
    const filters = buildThreadInteractionFilters({
      root: { type: 'E', id: ROOT_HEX, pubkey: 'c'.repeat(64) },
      opEventKind: kinds.ShortTextNote,
      limit: 100
    })
    expect(filters.length).toBeLessThanOrEqual(4)
    const eLower = filters.find((f) => f['#e']?.[0] === ROOT_HEX)
    expect(eLower?.kinds).toContain(kinds.ShortTextNote)
    expect(eLower?.kinds).toContain(kinds.Reaction)
    expect(filters.some((f) => f['#q']?.includes(ROOT_HEX))).toBe(true)
  })

  it('adds public-message #q filter for kind 24 OP', () => {
    const filters = buildThreadInteractionFilters({
      root: { type: 'E', id: ROOT_HEX, pubkey: 'c'.repeat(64) },
      opEventKind: ExtendedKind.PUBLIC_MESSAGE,
      limit: 50
    })
    expect(
      filters.some(
        (f) => f['#q']?.[0] === ROOT_HEX && f.kinds?.length === 1 && f.kinds[0] === ExtendedKind.PUBLIC_MESSAGE
      )
    ).toBe(true)
  })

  it('includes snapshot #e filters for replaceable A-root', () => {
    const filters = buildThreadInteractionFilters({
      root: {
        type: 'A',
        id: `30023:${'c'.repeat(64)}:note`,
        eventId: SNAP_HEX,
        pubkey: 'c'.repeat(64)
      },
      opEventKind: kinds.LongFormArticle,
      limit: 80
    })
    expect(filters.some((f) => f['#e']?.[0] === SNAP_HEX)).toBe(true)
    expect(filters.some((f) => f['#a']?.length === 1)).toBe(true)
  })
})
