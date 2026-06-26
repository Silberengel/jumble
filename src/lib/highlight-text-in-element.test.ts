import { describe, expect, it } from 'vitest'
import { findSearchHighlightNeedle } from '@/lib/general-search-text-match'
import {
  clearHighlightsInElement,
  highlightTextInElement,
  LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS
} from '@/lib/highlight-text-in-element'

function el(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('highlightTextInElement', () => {
  it('highlights a needle that spans multiple inline text nodes', () => {
    const root = el('<p>How <em>coarsely</em>, how stupidly excuse me</p>')
    const mark = highlightTextInElement(root, 'coarsely, how stupidly')
    expect(mark).toBeTruthy()
    const marks = root.querySelectorAll(`mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`)
    expect(marks.length).toBeGreaterThanOrEqual(1)
    const marked = Array.from(marks)
      .map((m) => m.textContent)
      .join('')
    expect(marked).toBe('coarsely, how stupidly')
  })

  it('matches case-insensitively', () => {
    const root = el('<p>The Word Development</p>')
    expect(highlightTextInElement(root, 'word development')).toBeTruthy()
  })

  it('clears previously inserted highlights and restores text', () => {
    const root = el('<p>alpha beta gamma</p>')
    highlightTextInElement(root, 'beta')
    clearHighlightsInElement(root)
    expect(root.querySelectorAll(`mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`).length).toBe(0)
    expect(root.textContent).toBe('alpha beta gamma')
  })

  it('end-to-end: a query with em dash + ellipsis markup finds and marks the rendered passage', () => {
    // Simulates AsciiDoctor output: em dash + zero-width space, ellipsis, and inline emphasis markup.
    const root = el(
      '<p>How coarsely, how stupidly\u2014\u200B<em>excuse</em> me saying so\u2014\u200Byou misunderstand the word development! Good heavens, how\u2026 crude</p>'
    )
    const query =
      'how stupidly--excuse me saying so--you misunderstand the word development'
    const needle = findSearchHighlightNeedle(root.textContent ?? '', query)
    expect(needle).toBeTruthy()
    const mark = highlightTextInElement(root, needle as string)
    expect(mark).toBeTruthy()
    const marked = Array.from(root.querySelectorAll(`mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`))
      .map((m) => m.textContent)
      .join('')
    expect(marked.toLowerCase()).toContain('excuse')
    expect(marked.toLowerCase()).toContain('misunderstand the word development')
  })
})
