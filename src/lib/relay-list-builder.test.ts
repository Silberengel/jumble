import { describe, expect, it } from 'vitest'
import { pickAuthorNip65RelaysPreferringViewerOverlap } from './relay-list-builder'

describe('pickAuthorNip65RelaysPreferringViewerOverlap', () => {
  it('prefers relays shared with the viewer, capped at max', () => {
    const author = [
      'wss://author-only.example/',
      'wss://shared.example/',
      'wss://author-two.example/'
    ]
    const viewer = ['wss://shared.example/', 'wss://viewer-only.example/']
    expect(pickAuthorNip65RelaysPreferringViewerOverlap(author, viewer, 2)).toEqual([
      'wss://shared.example/',
      'wss://author-only.example/'
    ])
  })
})
