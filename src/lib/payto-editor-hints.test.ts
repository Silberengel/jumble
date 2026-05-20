import { describe, expect, it } from 'vitest'
import {
  getCanonicalPaytoType,
  getPaytoAuthorityFieldHelp,
  getPaytoLogoPath,
  getPaytoEditorTypeLabel,
  getPaytoTypeInfo,
  isLightningPaytoType,
  isPaytoEditorCustomType,
  PAYTO_EDITOR_OTHER_OPTION,
  paytoEditorSelectTypes
} from './payto-registry'

describe('getPaytoAuthorityFieldHelp', () => {
  it('returns lightning-specific hint', () => {
    const help = getPaytoAuthorityFieldHelp('lightning')
    expect(help.placeholder).toContain('@')
    expect(help.hint.toLowerCase()).toContain('lud')
  })

  it('falls back for unknown types', () => {
    const help = getPaytoAuthorityFieldHelp('custom-coin')
    expect(help.hint).toContain('payto://')
  })
})

describe('paytoEditorSelectTypes', () => {
  it('ends with Other option', () => {
    const types = paytoEditorSelectTypes()
    expect(types[0]).toBe('lightning')
    expect(types.at(-1)).toBe(PAYTO_EDITOR_OTHER_OPTION)
    expect(types).not.toContain('custom-coin')
    expect(types).not.toContain('sats')
    expect(types).toContain('bolt12')
    expect(types).toContain('bip353')
    expect(types).toContain('bip352')
  })
})

describe('payto aliases', () => {
  it('maps sats to lightning (bitcoin-layer category)', () => {
    expect(getCanonicalPaytoType('sats')).toBe('lightning')
    expect(getPaytoTypeInfo('sats')?.category).toBe('bitcoin-layer')
    expect(getPaytoAuthorityFieldHelp('sats').hint.toLowerCase()).toContain('lud')
  })
})

describe('bitcoin family types', () => {
  it('uses bitcoin category for bolt12 and BIP-352 silent payments', () => {
    const help = getPaytoAuthorityFieldHelp('bolt12')
    expect(help.placeholder).toContain('lno1')
    expect(getPaytoTypeInfo('bip352')?.category).toBe('bitcoin')
    expect(getPaytoAuthorityFieldHelp('bip352').placeholder).toContain('sp1')
    expect(getPaytoEditorTypeLabel('bip352')).toBe('Silent Payments (BIP-352)')
  })

  it('treats BIP-353 as lightning-layer, not on-chain bitcoin', () => {
    expect(getPaytoTypeInfo('bip353')?.category).toBe('bitcoin-layer')
    expect(isLightningPaytoType('bip353')).toBe(true)
    expect(getPaytoEditorTypeLabel('bip353')).toBe('DNS Payment Instructions (BIP-353)')
    expect(getPaytoAuthorityFieldHelp('bip353').placeholder).toContain('@')
  })
})

describe('isPaytoEditorCustomType', () => {
  it('treats unknown types as custom', () => {
    expect(isPaytoEditorCustomType('custom-coin')).toBe(true)
    expect(isPaytoEditorCustomType(PAYTO_EDITOR_OTHER_OPTION)).toBe(true)
    expect(isPaytoEditorCustomType('lightning')).toBe(false)
  })
})

describe('getPaytoLogoPath', () => {
  it('resolves ethereum logo from catalog asset path', () => {
    const url = getPaytoLogoPath('ethereum')
    expect(url).toBeTruthy()
    expect(url!.length).toBeGreaterThan(10)
  })
})
