import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'
import { mergeTranslatedNote } from '@/lib/note-translation-display'
import { resolveNip84HighlightDisplay } from '@/lib/nip84-highlight-display'

function highlightEvent(overrides?: Partial<Event>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: kinds.Highlights,
    content: 'warmth of collectivism',
    tags: [
      [
        'context',
        'The warmth of collectivism, delivered through the infrastructure of control. This is the monetization of serfdom.'
      ]
    ],
    created_at: 0,
    sig: '',
    ...overrides
  } as Event
}

describe('mergeTranslatedNote', () => {
  it('patches context tag for NIP-84 highlights so quoted body can re-render in target language', () => {
    const event = highlightEvent()
    const merged = mergeTranslatedNote(event, {
      lang: 'nl',
      content: 'warmte van het collectivisme',
      context:
        'De warmte van het collectivisme, geleverd via de infrastructuur van controle. Dit is de monetisatie van horigheid.'
    })

    const { fullText, markedSpan } = resolveNip84HighlightDisplay(merged)
    expect(fullText).toContain('De warmte van het collectivisme')
    expect(markedSpan).toBe('warmte van het collectivisme')
    expect(fullText.includes(markedSpan)).toBe(true)
  })

  it('patches textquoteselector prefix and suffix', () => {
    const event = highlightEvent({
      content: 'exact quote',
      tags: [['textquoteselector', 'Before ', ' after']]
    })
    const merged = mergeTranslatedNote(event, {
      lang: 'nl',
      content: 'exacte quote',
      textQuotePrefix: 'Voor ',
      textQuoteSuffix: ' erna'
    })
    const { fullText, markedSpan } = resolveNip84HighlightDisplay(merged)
    expect(fullText).toBe('Voorexacte quoteerna')
    expect(markedSpan).toBe('exacte quote')
  })
})
