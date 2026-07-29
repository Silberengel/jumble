import { describe, expect, it } from 'vitest'
import { shouldLeaveDoubleBracketForAsciidoctor } from './asciidoc-double-bracket-guard'

describe('shouldLeaveDoubleBracketForAsciidoctor', () => {
  it('does not treat inline place-name wikilinks as biblio anchors', () => {
    const text =
      '* [[Perry High School (Perry, Iowa)]] — [[Perry, Iowa]]\n* [[Other]] — elsewhere'
    const iowa = '[[Perry, Iowa]]'
    const idx = text.indexOf(iowa)
    expect(shouldLeaveDoubleBracketForAsciidoctor(text, idx, iowa.length, 'Perry, Iowa')).toBe(
      false
    )
  })

  it('leaves bibliographic [[id,ref]] alone only when it is a full-line anchor before a heading', () => {
    const text = '[[bib,1]]\n\n== References\n\nBody.'
    const match = '[[bib,1]]'
    expect(shouldLeaveDoubleBracketForAsciidoctor(text, 0, match.length, 'bib,1')).toBe(true)
  })

  it('leaves lowercase slug anchors alone when alone before a heading', () => {
    const text = '[[intro]]\n\n== Intro\n\nBody.'
    expect(shouldLeaveDoubleBracketForAsciidoctor(text, 0, '[[intro]]'.length, 'intro')).toBe(true)
  })

  it('still routes uppercase wiki slugs through wiki passthrough', () => {
    const text = 'See [[NIP-54]] for details.'
    const match = '[[NIP-54]]'
    const idx = text.indexOf(match)
    expect(shouldLeaveDoubleBracketForAsciidoctor(text, idx, match.length, 'NIP-54')).toBe(false)
  })

  it('never leaves pipe display form for AsciiDoc', () => {
    const text = '[[Perry, Iowa|Perry]] — town'
    const match = '[[Perry, Iowa|Perry]]'
    expect(
      shouldLeaveDoubleBracketForAsciidoctor(text, 0, match.length, 'Perry, Iowa|Perry')
    ).toBe(false)
  })
})
