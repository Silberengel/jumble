import { describe, expect, it } from 'vitest'
import { mentionQueryLengthInText } from './suggestion'

describe('mentionQueryLengthInText', () => {
  it('includes the full handle after @', () => {
    expect(mentionQueryLengthInText('@Nusa')).toBe(5)
    expect(mentionQueryLengthInText('@Nusa more')).toBe(5)
  })

  it('includes dotted NIP-05 style handles', () => {
    expect(mentionQueryLengthInText('@user.name')).toBe(10)
  })

  it('supports query text without the leading @', () => {
    expect(mentionQueryLengthInText('Nusa')).toBe(4)
  })
})
