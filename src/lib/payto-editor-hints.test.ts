import { describe, expect, it } from 'vitest'
import { getPaytoAuthorityFieldHelp, getPaytoLogoPath, paytoEditorSelectTypes } from './payto-registry'

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
  it('appends custom type not in curated list', () => {
    const types = paytoEditorSelectTypes('custom-coin')
    expect(types[0]).toBe('lightning')
    expect(types).toContain('custom-coin')
  })
})

describe('getPaytoLogoPath', () => {
  it('resolves ethereum logo from catalog asset path', () => {
    const url = getPaytoLogoPath('ethereum')
    expect(url).toBeTruthy()
    expect(url!.length).toBeGreaterThan(10)
  })
})
