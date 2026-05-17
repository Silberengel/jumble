import { describe, expect, it } from 'vitest'
import { buildHiveTalkJoinUrl, roomIdForPubkeys, roomIdForScheduledCall } from './hivetalk'

describe('buildHiveTalkJoinUrl', () => {
  it('returns path-only meet URL without query params', () => {
    const id = '16d6d544e487c2cee3eb4c37654ba7dcc841ba4cd0e404c99af8ef4ffa7c020d'
    expect(buildHiveTalkJoinUrl({ room: `imwald-note-${id}` })).toBe(
      `https://honey.hivetalk.org/meet/imwald-note-${id}`
    )
  })

  it('strips leading slashes from room', () => {
    expect(buildHiveTalkJoinUrl({ room: '/my-room' })).toBe('https://honey.hivetalk.org/meet/my-room')
  })
})

describe('roomIdForPubkeys', () => {
  it('is symmetric', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(roomIdForPubkeys(a, b)).toBe(roomIdForPubkeys(b, a))
  })
})

describe('roomIdForScheduledCall', () => {
  it('prefixes d tag', () => {
    expect(roomIdForScheduledCall('abc')).toBe('jumble-cal-abc')
  })
})
