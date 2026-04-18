import { describe, expect, it, vi, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import client from '@/services/client.service'
import { expandNostrReferencesForReadAloud } from '@/lib/read-aloud'

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { name?: string }) => {
      const table: Record<string, string> = {
        'Read aloud unknown author': 'Unknown author',
        'Read aloud embedded note unavailable': 'Quoted note not loaded.',
        'Read aloud nostr profile unavailable': 'Nostr profile reference.',
        'Read aloud relay reference': 'Nostr relay reference.',
        'Read aloud nostr reference unavailable': 'Nostr reference.'
      }
      if (key === 'Read aloud quoted from') {
        return `Quoted from ${opts?.name ?? ''}.`
      }
      return table[key] ?? key
    }
  },
  normalizeToSupportedAppLanguage: (c: string) => c as 'en',
  LocalizedLanguageNames: {} as Record<'en', string>
}))

vi.mock('@/services/client.service', () => ({
  default: {
    peekSessionCachedEvent: vi.fn(),
    eventService: {
      getSessionMetadataForPubkey: vi.fn()
    }
  }
}))

const peek = vi.mocked(client.peekSessionCachedEvent)
const getMeta = vi.mocked(client.eventService.getSessionMetadataForPubkey)

describe('expandNostrReferencesForReadAloud', () => {
  beforeEach(() => {
    peek.mockReset()
    getMeta.mockReset()
  })

  it('leaves plain text unchanged', () => {
    expect(expandNostrReferencesForReadAloud('hello world')).toBe('hello world')
  })

  it('replaces nostr:note with placeholder when event is not cached', () => {
    const sk = generateSecretKey()
    const ev = finalizeEvent({ kind: 1, content: 'x', tags: [], created_at: 1 }, sk)
    const note = nip19.noteEncode(ev.id)
    peek.mockReturnValue(undefined)
    expect(expandNostrReferencesForReadAloud(`See nostr:${note} please`)).toBe('See Quoted note not loaded. please')
  })

  it('replaces nostr:note with quoted-from line and body when cached', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const inner = finalizeEvent({ kind: 1, content: 'Inner **bold**', tags: [], created_at: 2 }, sk)
    const note = nip19.noteEncode(inner.id)
    peek.mockImplementation((id: string) => {
      if (id === note || id === inner.id) return inner as Event
      return undefined
    })
    const profile = finalizeEvent(
      {
        kind: 0,
        pubkey: pk,
        content: JSON.stringify({ display_name: 'Pat' }),
        tags: [],
        created_at: 1
      },
      sk
    ) as Event
    getMeta.mockImplementation((hex: string) => (hex.toLowerCase() === pk.toLowerCase() ? profile : undefined))
    const out = expandNostrReferencesForReadAloud(`Quote: nostr:${note} end`)
    expect(out).toContain('Quoted from Pat.')
    expect(out).toContain('Inner bold')
    expect(out).not.toContain('nostr:')
  })

  it('uses unknown author when embedded note is cached but profile is not', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const inner = finalizeEvent({ kind: 1, content: 'Hi', tags: [], created_at: 2 }, sk)
    const note = nip19.noteEncode(inner.id)
    peek.mockImplementation((id: string) => (id === note || id === inner.id ? (inner as Event) : undefined))
    getMeta.mockReturnValue(undefined)
    const out = expandNostrReferencesForReadAloud(`nostr:${note}`)
    expect(out).toMatch(/^Quoted from Unknown author\. Hi$/)
  })

  it('replaces nostr:npub with display name when kind 0 is cached', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const profile = finalizeEvent(
      {
        kind: 0,
        pubkey: pk,
        content: JSON.stringify({ name: 'n_name' }),
        tags: [],
        created_at: 1
      },
      sk
    ) as Event
    const npub = nip19.npubEncode(pk)
    getMeta.mockImplementation((hex: string) => (hex.toLowerCase() === pk.toLowerCase() ? profile : undefined))
    expect(expandNostrReferencesForReadAloud(`Hey nostr:${npub}!`)).toBe('Hey n_name!')
  })

  it('replaces nostr:npub with placeholder when profile is not cached', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const npub = nip19.npubEncode(pk)
    getMeta.mockReturnValue(undefined)
    expect(expandNostrReferencesForReadAloud(`x nostr:${npub} y`)).toBe('x Nostr profile reference. y')
  })

  it('does not match bare npub inside nostr:npub… (no double replacement)', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const npub = nip19.npubEncode(pk)
    getMeta.mockReturnValue(undefined)
    expect(expandNostrReferencesForReadAloud(`nostr:${npub}`)).toBe('Nostr profile reference.')
  })
})
