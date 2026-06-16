import { describe, expect, it } from 'vitest'
import {
  buildCitationDraftEvent,
  emptyCitationFormValues,
  isCitationFormValid
} from '@/lib/citation-form'
import { ExtendedKind } from '@/constants'

describe('citation-form', () => {
  it('validates external citation requires url and accessedOn', () => {
    const v = emptyCitationFormValues()
    expect(isCitationFormValid('external', v)).toBe(false)
    v.externalUrl = 'https://example.com'
    v.accessedOn = '2026-01-01'
    expect(isCitationFormValid('external', v)).toBe(true)
  })

  it('buildCitationDraftEvent creates kind 31 for external', () => {
    const v = emptyCitationFormValues()
    v.externalUrl = 'https://example.com/page'
    v.accessedOn = '2026-01-01'
    const draft = buildCitationDraftEvent('external', 'excerpt', v)
    expect(draft.kind).toBe(ExtendedKind.CITATION_EXTERNAL)
    expect(draft.content).toBe('excerpt')
    expect(draft.tags.some((t) => t[0] === 'u' && t[1] === 'https://example.com/page')).toBe(true)
  })
})
