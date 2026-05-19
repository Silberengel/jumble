import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { parseNip56Report } from './nip56-report-display'

describe('parseNip56Report', () => {
  it('reads reason from e tag relay field', () => {
    const event = {
      kind: kinds.Report,
      pubkey: 'aa'.repeat(32),
      id: 'bb'.repeat(32),
      sig: 'cc'.repeat(32),
      created_at: 1,
      tags: [
        ['p', 'dd'.repeat(32)],
        ['e', 'ee'.repeat(32), 'spam']
      ],
      content: ''
    }
    const parsed = parseNip56Report(event)
    expect(parsed?.reason).toBe('spam')
    expect(parsed?.reportedEventIds).toEqual(['ee'.repeat(32)])
  })

  it('prefers content over report tag', () => {
    const event = {
      kind: kinds.Report,
      pubkey: 'aa'.repeat(32),
      id: 'bb'.repeat(32),
      sig: 'cc'.repeat(32),
      created_at: 1,
      tags: [['report', 'nudity']],
      content: 'explicit content'
    }
    const parsed = parseNip56Report(event)
    expect(parsed?.reportType).toBe('nudity')
    expect(parsed?.reason).toBe('explicit content')
  })
})
