import { describe, expect, it } from 'vitest'
import {
  normalizeComposerExtraTags,
  parseComposerTagValuesInput,
  type ComposerExtraTagRow
} from './composer-extra-tags'

function row(tag: string[]): ComposerExtraTagRow {
  return { id: '1', tag }
}

describe('normalizeComposerExtraTags', () => {
  it('drops rows without a tag name', () => {
    expect(normalizeComposerExtraTags([row(['', 'x']), row(['t', 'a'])])).toEqual([['t', 'a']])
  })

  it('trims tag name and values', () => {
    expect(normalizeComposerExtraTags([row(['  k  ', ' 1 ', '2 '])])).toEqual([['k', '1', '2']])
  })
})

describe('parseComposerTagValuesInput', () => {
  it('splits on newlines and drops empty lines', () => {
    expect(parseComposerTagValuesInput('a\n\n b \n')).toEqual(['a', 'b'])
  })
})
