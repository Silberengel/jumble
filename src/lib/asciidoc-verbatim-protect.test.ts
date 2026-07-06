import { describe, expect, it } from 'vitest'
import {
  looksLikeNativeAsciidoc,
  protectAsciiDocVerbatimRegions,
  restoreAsciiDocVerbatimRegions
} from './asciidoc-verbatim-protect'

const NKBIP_INLINE = `* MUST include a \`title\` tag containing the full title
* MUST include an \`E\` tag referencing the original event immediately after the \`p\` tag
* MAY contain the tag \`source\`, which defines a URL`

const NKBIP_SOURCE = `[source,json]
----
{
  "content": "A fable, by [[Aesop]]."
}
----`

describe('protectAsciiDocVerbatimRegions', () => {
  it('shields source blocks from outer preprocessing', () => {
    const input = `Intro line\n\n${NKBIP_SOURCE}\n\nOutro`
    const { text, blocks } = protectAsciiDocVerbatimRegions(input)
    expect(text).not.toContain('[[Aesop]]')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('[[Aesop]]')
    expect(restoreAsciiDocVerbatimRegions(text, blocks)).toBe(input)
  })

  it('includes [source,...] attribute line in protected range', () => {
    const input = NKBIP_SOURCE
    const { text, blocks } = protectAsciiDocVerbatimRegions(input)
    expect(text).not.toContain('[source,json]')
    expect(blocks[0]).toMatch(/^\[source,json\]/)
  })
})

describe('looksLikeNativeAsciidoc', () => {
  it('detects NKBIP-style AsciiDoc', () => {
    expect(looksLikeNativeAsciidoc('= NKBIP-01: Curated Publications\n\n== Event Kinds')).toBe(
      true
    )
    expect(looksLikeNativeAsciidoc(NKBIP_INLINE)).toBe(false)
    expect(looksLikeNativeAsciidoc('# Markdown title\n\nBody')).toBe(false)
  })
})
