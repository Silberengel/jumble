import { describe, expect, it } from 'vitest'
import {
  composerTagRowFromNostrTag,
  normalizeComposerExtraTags,
  parseComposerTagValuesInput,
  type ComposerExtraTagRow
} from './composer-extra-tags'

function row(name: string, valuesRaw = ''): ComposerExtraTagRow {
  return { id: '1', name, valuesRaw }
}

describe('normalizeComposerExtraTags', () => {
  it('drops rows without a tag name', () => {
    expect(normalizeComposerExtraTags([row('', 'x'), row('t', 'a')])).toEqual([['t', 'a']])
  })

  it('trims tag name and values', () => {
    expect(normalizeComposerExtraTags([row('  k  ', ' 1 \n2 ')])).toEqual([['k', '1', '2']])
  })

  it('builds from nostr tag arrays', () => {
    expect(normalizeComposerExtraTags([composerTagRowFromNostrTag(['t', 'a', 'b'])])).toEqual([
      ['t', 'a', 'b']
    ])
  })
})

describe('parseComposerTagValuesInput', () => {
  it('splits on newlines and drops empty lines', () => {
    expect(parseComposerTagValuesInput('a\n\n b \n')).toEqual(['a', 'b'])
  })
})

describe('composerTagRowFromNostrTag', () => {
  it('preserves multiline values in raw form', () => {
    const editable = composerTagRowFromNostrTag(['summary', 'line one', 'line two'])
    expect(editable.name).toBe('summary')
    expect(editable.valuesRaw).toBe('line one\nline two')
  })
})
