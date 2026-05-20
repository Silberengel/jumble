import { describe, expect, it } from 'vitest'
import {
  MAX_ZAP_SATS,
  clampZapSats,
  parseGroupedIntegerInput,
  shouldHighlightLeadingSatsGroups,
  splitSatsGroupedParts
} from './lightning'

describe('zap sats amount limits', () => {
  it('clamps to 7 digits', () => {
    expect(clampZapSats(99_999_999)).toBe(MAX_ZAP_SATS)
    expect(parseGroupedIntegerInput('12345678')).toBe(1_234_567)
  })

  it('highlights leading group above 999 999 sats', () => {
    expect(shouldHighlightLeadingSatsGroups(999_999)).toBe(false)
    expect(shouldHighlightLeadingSatsGroups(1_000_000)).toBe(true)
    expect(splitSatsGroupedParts(1_000_000)).toEqual(['1', '000', '000'])
  })
})
