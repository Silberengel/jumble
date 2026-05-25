import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ZAP_SATS,
  LN_INVOICE_PRESET_SATS,
  MAX_ZAP_SATS,
  MIN_ZAP_SATS,
  SAT_GROUP_SEPARATOR,
  ZAP_SATS_HIGHLIGHT_ABOVE,
  clampZapSats,
  formatSatsGrouped,
  parseGroupedIntegerInput,
  shouldHighlightLeadingSatsGroups,
  splitSatsGroupedParts
} from './lightning'

/** Overlay text must match the transparent input value (GroupedSatsInput). */
function groupedDisplayString(amount: number): string {
  return splitSatsGroupedParts(amount).join(SAT_GROUP_SEPARATOR)
}

describe('lightning zap amounts', () => {
  describe('LN invoice presets and defaults', () => {
    it('defines min, default, and five preset buttons', () => {
      expect(MIN_ZAP_SATS).toBe(210)
      expect(DEFAULT_ZAP_SATS).toBe(420)
      expect([...LN_INVOICE_PRESET_SATS]).toEqual([210, 420, 2100, 4200, 21_000])
      expect(LN_INVOICE_PRESET_SATS[0]).toBe(MIN_ZAP_SATS)
      expect(LN_INVOICE_PRESET_SATS).toContain(DEFAULT_ZAP_SATS)
    })
  })

  describe('clamp and parse', () => {
    it('clamps to 7 digits', () => {
      expect(clampZapSats(99_999_999)).toBe(MAX_ZAP_SATS)
      expect(parseGroupedIntegerInput('12345678')).toBe(1_234_567)
    })

    it('strips grouping separators and non-digits when parsing', () => {
      expect(parseGroupedIntegerInput(`1${SAT_GROUP_SEPARATOR}234${SAT_GROUP_SEPARATOR}567`)).toBe(
        1_234_567
      )
      expect(parseGroupedIntegerInput('1,234,567')).toBe(1_234_567)
      expect(parseGroupedIntegerInput('')).toBe(0)
    })
  })

  describe('grouped display (overlay + input)', () => {
    it('formats with thin spaces between digit groups', () => {
      expect(formatSatsGrouped(2100)).toBe(`2${SAT_GROUP_SEPARATOR}100`)
      expect(formatSatsGrouped(1_000_000)).toBe(`1${SAT_GROUP_SEPARATOR}000${SAT_GROUP_SEPARATOR}000`)
    })

    it('keeps overlay segments aligned with the input string', () => {
      for (const amount of [210, 420, 2100, 4200, 21_000, 42_000, 1_000_000, 9_999_999]) {
        expect(groupedDisplayString(amount)).toBe(formatSatsGrouped(amount))
      }
    })

    it('splits into digit groups without separators in parts', () => {
      expect(splitSatsGroupedParts(1_000_000)).toEqual(['1', '000', '000'])
      expect(splitSatsGroupedParts(420)).toEqual(['420'])
    })
  })

  describe('leading group highlight', () => {
    it('is off at or below the threshold', () => {
      expect(ZAP_SATS_HIGHLIGHT_ABOVE).toBe(999_999)
      expect(shouldHighlightLeadingSatsGroups(999_999)).toBe(false)
      expect(shouldHighlightLeadingSatsGroups(42_000)).toBe(false)
    })

    it('is on above 999 999 sats', () => {
      expect(shouldHighlightLeadingSatsGroups(1_000_000)).toBe(true)
      expect(shouldHighlightLeadingSatsGroups(MAX_ZAP_SATS)).toBe(true)
    })
  })
})
