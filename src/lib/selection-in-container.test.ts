import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  isRangeInContainer,
  readSelectionInContainer,
  readSelectionInContainerWithRetry
} from '@/lib/selection-in-container'

function mount(html: string): { root: HTMLElement; container: HTMLElement } {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  const container = root.querySelector('[data-container]') as HTMLElement
  return { root, container }
}

function selectText(node: Node, start: number, end: number): Range {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('isRangeInContainer', () => {
  it('returns true when both range endpoints are inside the container', () => {
    const { root, container } = mount(
      '<div data-container><p>Hello <span>world</span></p></div>'
    )
    const text = container.querySelector('span')!.firstChild!
    const range = selectText(text, 0, 5)

    expect(isRangeInContainer(range, container)).toBe(true)

    root.remove()
  })

  it('returns false when the range is entirely outside the container', () => {
    const { root, container } = mount(
      '<div><p id="outside">Outside</p><div data-container><p>Inside</p></div></div>'
    )
    const outside = root.querySelector('#outside')!.firstChild!
    const range = selectText(outside, 0, 7)

    expect(isRangeInContainer(range, container)).toBe(false)

    root.remove()
  })

  it('returns true for multi-paragraph selections via client rects overlap', () => {
    const { root, container } = mount(
      '<div data-container><p>First paragraph</p><p>Second paragraph</p></div>'
    )
    const first = container.querySelectorAll('p')[0].firstChild!
    const second = container.querySelectorAll('p')[1].firstChild!
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(second, 6)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(isRangeInContainer(range, container)).toBe(true)

    root.remove()
  })
})

describe('readSelectionInContainerWithRetry', () => {
  it('calls onHit after the selection is readable', async () => {
    const { root, container } = mount('<div data-container><p>Hello world</p></div>')
    const text = container.querySelector('p')!.firstChild!
    selectText(text, 0, 5)

    const onHit = vi.fn()
    readSelectionInContainerWithRetry(container, onHit)

    await nextFrame()
    await nextFrame()
    await new Promise((r) => setTimeout(r, 250))

    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onHit.mock.calls[0][0].selectedText).toBe('Hello')

    root.remove()
  })

  it('reads range.toString when selection.toString is empty', () => {
    const { root, container } = mount('<div data-container><p>Fallback text</p></div>')
    const text = container.querySelector('p')!.firstChild!
    selectText(text, 0, 8)

    const hit = readSelectionInContainer(container)
    expect(hit?.selectedText).toBe('Fallback')

    root.remove()
  })
})
