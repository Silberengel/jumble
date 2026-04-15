import { describe, expect, it } from 'vitest'
import { parseEditorJsonToText, plainTextToTipTapDoc } from '@/lib/tiptap'

describe('plainTextToTipTapDoc', () => {
  it('round-trips simple lines', () => {
    const plain = 'hello\nworld'
    const doc = plainTextToTipTapDoc(plain)
    expect(parseEditorJsonToText(doc).trim()).toBe(plain)
  })

  it('handles empty string', () => {
    const doc = plainTextToTipTapDoc('')
    expect(parseEditorJsonToText(doc).trim()).toBe('')
  })

  it('handles blank line between paragraphs', () => {
    const plain = 'a\n\nb'
    const doc = plainTextToTipTapDoc(plain)
    expect(parseEditorJsonToText(doc).trim()).toBe(plain)
  })

  it('normalizes CRLF', () => {
    const doc = plainTextToTipTapDoc('x\r\ny')
    expect(parseEditorJsonToText(doc).trim()).toBe('x\ny')
  })
})
