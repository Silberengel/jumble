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

  it('preserves order of multiple source blocks', () => {
    const blockA = `[source,json]\n----\n{"id": "first"}\n----`
    const blockB = `[source,json]\n----\n{"id": "second"}\n----`
    const blockC = `[source,json]\n----\n{"id": "third"}\n----`
    const input = `Before\n\n${blockA}\n\nBetween A and B\n\n${blockB}\n\nBetween B and C\n\n${blockC}\n\nAfter`
    const { text, blocks } = protectAsciiDocVerbatimRegions(input)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toContain('"first"')
    expect(blocks[1]).toContain('"second"')
    expect(blocks[2]).toContain('"third"')
    const restored = restoreAsciiDocVerbatimRegions(text, blocks)
    expect(restored).toBe(input)
    expect(restored.indexOf('"first"')).toBeLessThan(restored.indexOf('"second"'))
    expect(restored.indexOf('"second"')).toBeLessThan(restored.indexOf('"third"'))
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
