import { describe, expect, it } from 'vitest'
import { libraryPublicationGridColumnClass } from '@/hooks/usePanelMode'

describe('libraryPublicationGridColumnClass', () => {
  it('uses 1 column on mobile', () => {
    expect(libraryPublicationGridColumnClass(true, 'single')).toBe('grid-cols-1')
    expect(libraryPublicationGridColumnClass(true, 'double')).toBe('grid-cols-1')
  })

  it('uses 2 columns in double-pane desktop', () => {
    expect(libraryPublicationGridColumnClass(false, 'double')).toBe('grid-cols-2')
  })

  it('uses 3 columns in single-pane desktop', () => {
    expect(libraryPublicationGridColumnClass(false, 'single')).toBe('grid-cols-3')
  })
})
