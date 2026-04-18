import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { getParentBech32Id, getParentEventHexId, getRootEventHexId } from './event'

/** Kind 1111 sample: E/e point at a kind-1 parent; must not resolve parent hex to the comment id. */
const fiatjafCommentSample = {
  id: '10144b660d2aaf4eb65f5e60e7cc9d5e3fed7854073f57c1773929837d332dc1',
  pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
  kind: 1111,
  created_at: 1776511298,
  content: 'x',
  sig: '0'.repeat(128),
  tags: [
    [
      'E',
      '2c88e6bdf1d51d52037078624b21f07eefd86f3413be78efdb64e4931bb6bc99',
      '',
      '1f79058c77a224e5be226c8f024cacdad4d741855d75ed9f11473ba8eb86e1cb'
    ],
    ['P', '1f79058c77a224e5be226c8f024cacdad4d741855d75ed9f11473ba8eb86e1cb'],
    ['K', '1'],
    [
      'e',
      '2c88e6bdf1d51d52037078624b21f07eefd86f3413be78efdb64e4931bb6bc99',
      '',
      '1f79058c77a224e5be226c8f024cacdad4d741855d75ed9f11473ba8eb86e1cb'
    ],
    ['k', '1'],
    ['p', '1f79058c77a224e5be226c8f024cacdad4d741855d75ed9f11473ba8eb86e1cb']
  ]
} as const

describe('kind 1111 parent / root resolution', () => {
  it('resolves parent and root hex to the threaded kind-1 id, not the comment id', () => {
    const ev = { ...fiatjafCommentSample } as any
    expect(getParentEventHexId(ev)).toBe(
      '2c88e6bdf1d51d52037078624b21f07eefd86f3413be78efdb64e4931bb6bc99'
    )
    expect(getRootEventHexId(ev)).toBe(
      '2c88e6bdf1d51d52037078624b21f07eefd86f3413be78efdb64e4931bb6bc99'
    )
    expect(getParentEventHexId(ev)).not.toBe(ev.id)
  })

  it('parent bech32 decodes to the parent hex id', () => {
    const ev = { ...fiatjafCommentSample } as any
    const parentBech32 = getParentBech32Id(ev)
    expect(parentBech32).toBeTruthy()
    const decoded = nip19.decode(parentBech32!)
    expect(decoded.type).toBe('nevent')
    if (decoded.type === 'nevent') {
      expect(decoded.data.id).toBe(
        '2c88e6bdf1d51d52037078624b21f07eefd86f3413be78efdb64e4931bb6bc99'
      )
      expect(decoded.data.id).not.toBe(ev.id)
    }
  })
})
