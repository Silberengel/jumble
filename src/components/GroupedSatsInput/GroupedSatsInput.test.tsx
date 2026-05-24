import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import GroupedSatsInput from './index'
import {
  formatSatsGrouped,
  SAT_GROUP_SEPARATOR,
  splitSatsGroupedParts
} from '@/lib/lightning'
import { superchatSatsLeadingHighlightClass } from '@/lib/superchat-ui'

describe('GroupedSatsInput', () => {
  it('shows the same grouped string in the input as on the overlay', () => {
    render(<GroupedSatsInput sats={1_234_567} onSatsChange={() => {}} id="test-sats" />)
    const input = screen.getByRole('textbox', { name: '' })
    expect(input).toHaveAttribute('id', 'test-sats')
    expect(input).toHaveValue(formatSatsGrouped(1_234_567))
  })

  it('highlights only the leading digit group above 999 999 sats', () => {
    const { container, rerender } = render(
      <GroupedSatsInput sats={420} onSatsChange={() => {}} />
    )
    expect(container.querySelector(`.${superchatSatsLeadingHighlightClass.split(' ')[0]}`)).toBeNull()

    rerender(<GroupedSatsInput sats={1_000_000} onSatsChange={() => {}} />)
    const parts = splitSatsGroupedParts(1_000_000)
    const highlighted = container.querySelector(`.${superchatSatsLeadingHighlightClass.split(' ')[0]}`)
    expect(highlighted).toHaveTextContent(parts[0]!)
    expect(highlighted?.textContent).toBe('1')
  })

  it('renders overlay groups joined with thin spaces (no flex gap)', () => {
    const { container } = render(<GroupedSatsInput sats={21_000} onSatsChange={() => {}} />)
    const overlay = container.querySelector('[aria-hidden] span.whitespace-nowrap')
    expect(overlay?.textContent).toBe(
      splitSatsGroupedParts(21_000).join(SAT_GROUP_SEPARATOR)
    )
  })

  it('parses edited grouped input', () => {
    const onSatsChange = vi.fn()
    render(<GroupedSatsInput sats={420} onSatsChange={onSatsChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: `2${SAT_GROUP_SEPARATOR}100` } })
    expect(onSatsChange).toHaveBeenLastCalledWith(2100)
  })
})
