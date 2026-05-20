import { ExtendedKind } from '@/constants'
import { networkKindsForReplaceableFetch } from '@/lib/replaceable-fetch-kinds'
import { kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

describe('networkKindsForReplaceableFetch', () => {
  it('includes kind 10133 when fetching kind 0', () => {
    expect(networkKindsForReplaceableFetch(kinds.Metadata)).toEqual([
      kinds.Metadata,
      ExtendedKind.PAYMENT_INFO
    ])
  })

  it('leaves other replaceable kinds unchanged', () => {
    expect(networkKindsForReplaceableFetch(kinds.Contacts)).toEqual([kinds.Contacts])
    expect(networkKindsForReplaceableFetch(ExtendedKind.PAYMENT_INFO)).toEqual([
      ExtendedKind.PAYMENT_INFO
    ])
  })
})
