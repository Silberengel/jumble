import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { translateNoteForDisplay } from '@/lib/translate-note-for-menu'

const BLOCKQUOTE_THREE_LINES =
  'Intro paragraph.\n\n' +
  '> Stephen cheered when John was fired.\n' +
  '> We do not like Stephen.\n' +
  '> John should not have been fired.\n\n' +
  'After quote.'

vi.mock('@/lib/translate-client', () => ({
  /** Identity so chunk assembly can be asserted without delimiter noise from the mock. */
  translatePlainText: vi.fn(async (text: string) => text),
  normalizeTranslateLangCode: (c: string) => c,
  translateApiLanguageCode: (c: string) => c,
  translateServerSupportsLogicalTarget: () => true,
  isTranslateConfigured: () => true,
  fetchTranslateLanguages: vi.fn(async () => []),
  clearTranslateLanguagesCache: vi.fn()
}))

function kind1Event(content: string): Event {
  return {
    id: '0'.repeat(64),
    pubkey: '1'.repeat(64),
    kind: 1,
    content,
    tags: [],
    created_at: 0,
    sig: ''
  } as Event
}

describe('translateNoteForDisplay', () => {
  afterEach(async () => {
    const { translatePlainText } = await import('@/lib/translate-client')
    vi.mocked(translatePlainText).mockImplementation(async (text: string) => text)
  })

  it('keeps blank lines across chunk boundaries (list → paragraph)', async () => {
    const fill = 'word '.repeat(520)
    const content = `${fill.trimEnd()}\n\nFINAL_LINE_UNIQUE`
    expect(content.length).toBeGreaterThan(2500)

    const out = await translateNoteForDisplay(kind1Event(content), 'fr')
    expect(out.content).toContain('\n\nFINAL_LINE_UNIQUE')
  })

  it('keeps markdown bullet list, blank line, and paragraph across chunk splits', async () => {
    const long = 'x'.repeat(700)
    const tail = 'z'.repeat(2200)
    const content = `- ${long}\n- y\n\nPARA_MARKER${tail}`
    expect(content.length).toBeGreaterThan(2500)

    const out = await translateNoteForDisplay(kind1Event(content), 'fr')
    expect(out.content).toContain('\n\nPARA_MARKER')
    expect(out.content).toContain('- y')
    expect(out.content).toContain('PARA_MARKER')
    expect(out.content).toBe(content)
  })

  it('coalesces consecutive Markdown blockquote bodies into one translatePlainText (embedded newlines)', async () => {
    const { translatePlainText } = await import('@/lib/translate-client')
    const spy = vi.mocked(translatePlainText)
    spy.mockClear()
    spy.mockImplementation(async (s: string) => `[${s}]`)
    const ev = {
      id: '0'.repeat(64),
      pubkey: '1'.repeat(64),
      kind: 1,
      content: BLOCKQUOTE_THREE_LINES,
      tags: [],
      created_at: 0,
      sig: ''
    } as Event
    await translateNoteForDisplay(ev, 'de')
    const payloads = spy.mock.calls.map((c) => String(c[0]))
    const merged = payloads.find(
      (p) => p.includes('Stephen cheered when John was fired') && p.includes('We do not like Stephen')
    )
    expect(merged).toBeDefined()
    expect(merged).toContain('John should not have been fired')
  })
})
