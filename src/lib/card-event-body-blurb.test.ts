import { describe, expect, it } from 'vitest'
import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'

const SUBSTACK_IMG =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'
const SUBSTACK_LINK =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'

describe('cardEventBodyBlurb', () => {
  it('strips nested substack image links and keeps article text', () => {
    const content = `[![](${SUBSTACK_IMG})](${SUBSTACK_LINK})Test article for posting on nostr.\n\n- Good\n  - Better\n    - Best`
    expect(cardEventBodyBlurb(content)).toBe(
      'Test article for posting on nostr. Good - Better - Best'
    )
  })

  it('strips simple markdown image syntax', () => {
    expect(cardEventBodyBlurb('![](https://example.com/a.jpg)Hello world')).toBe('Hello world')
  })

  it('strips setext heading underlines in markdown', () => {
    const content = 'NIP-FF-3\n======\nEdit-Durable Content Attribution\n------------------\nNIP-03 was designed for immutable events.'
    expect(cardEventBodyBlurb(content)).toBe(
      'NIP-FF-3 Edit-Durable Content Attribution NIP-03 was designed for immutable events.'
    )
  })

  it('strips asciidoc markup (headings, attributes, comments, macros, delimiters)', () => {
    const content = [
      '= Wiki Article',
      ':toc: macro',
      '// internal note',
      '',
      '== Background',
      '',
      'See image::diagram.png[The diagram] and link:https://example.com[the site].',
      '',
      '----',
      'code block',
      '----',
      '',
      '.Block title',
      'Body text here.'
    ].join('\n')
    expect(cardEventBodyBlurb(content, { markup: 'asciidoc' })).toBe(
      'Wiki Article Background See The diagram and the site. code block Block title Body text here.'
    )
  })

  it('replaces wiki links with display text and drops citations', () => {
    const content =
      'Madagascar is an **[[island country]]** in the **[[Indian Ocean]]** that includes the [[Geography of Madagascar|island of Madagascar]]. [[citation::web::nevent1qq…]]'
    expect(cardEventBodyBlurb(content, { markup: 'asciidoc' })).toBe(
      'Madagascar is an island country in the Indian Ocean that includes the island of Madagascar.'
    )
  })

  it('respects a custom max length', () => {
    expect(cardEventBodyBlurb('one two three four', { max: 7 })).toBe('one two…')
  })
})
