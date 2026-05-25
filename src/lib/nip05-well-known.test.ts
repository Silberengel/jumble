import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { parseNip05NamePubkeyEntry, parseNip05NamePubkeysFromWellKnownJson } from '@/lib/nip05'

const THEFOREST_WELL_KNOWN = {
  names: {
    '137': '6da819f91d69cbe591c08b31f555c6d0ab9905197eb515856e339049c018c1af',
    '430': '6da819f91d69cbe591c08b31f555c6d0ab9905197eb515856e339049c018c1af',
    cloudfodder: '7cc328a08ddb2afdf9f9be77beff4c83489ff979721827d628a542f32a247c0e',
    laeserin: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
    testuser: 'd04bc6808885b8db9c344675c89b442e5f1c30430548bfb263731e1b662d4846',
    testerin: '573634b648634cbad10f2451776089ea21090d9407f715e83c577b4611ae6edc',
    metoo: '59c67d18b2e470fc5a6dd27c8f21ed538d9047808304ebd3305bc104dfc83627',
    crackerjack: '58d953d05e751803dbb7b8b58f130b5553c13286e04951eac901c50e08ee7313',
    nostrbots: 'dcc95cc9b0b85802e634f407ed91990471bd69d4af07e719eea8ddfc93f20153',
    poe: 'e034d654802d7cfaa2d41a952801054114e09ad6a352b28288e23075ca919814',
    YODL: 'd28413712171c33e117d4bd0930ac05b2c51b30eb3021ef8d4f1233f02c90a2b',
    superuserdo: '5b0867ea4a23b3b04fe17d0ed52d4529661514b4d84d4a1d86f98eb7c175aab1',
    daniel: 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74',
    orange: 'de599d3d84a30f8dcb1dd86658655b1ee0318880dc9e53cdc6c367c0b9498700',
    ThatWhichisNotSeen: 'cf8f07ebffbdce4976ea8ab830cfd6036ffb6203e67ba8eb7a9a448a742a6eaa'
  },
  relays: {
    '137': [],
    cloudfodder: ['wss://nostr21.com'],
    laeserin: [],
    metoo: ['wss://nostr21.com']
  }
} as const

describe('parseNip05NamePubkeysFromWellKnownJson', () => {
  it('parses theforest.nostr1.com well-known names', () => {
    const rows = parseNip05NamePubkeysFromWellKnownJson(THEFOREST_WELL_KNOWN)
    expect(rows).toHaveLength(15)
    expect(rows.find((r) => r.name === 'laeserin')?.pubkey).toBe(
      'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
    )
    expect(rows.find((r) => r.name === '137')?.pubkey).toBe(
      '6da819f91d69cbe591c08b31f555c6d0ab9905197eb515856e339049c018c1af'
    )
    expect(rows.find((r) => r.name === 'YODL')?.pubkey).toBe(
      'd28413712171c33e117d4bd0930ac05b2c51b30eb3021ef8d4f1233f02c90a2b'
    )
  })

  it('rejects proxy error stubs without names', () => {
    expect(parseNip05NamePubkeysFromWellKnownJson({ ok: false, error: 'og_proxy_unreachable' })).toEqual(
      []
    )
  })

  it('parses npub-keyed names with username labels', () => {
    const laeserinHex = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
    const npub = nip19.npubEncode(laeserinHex)
    const rows = parseNip05NamePubkeysFromWellKnownJson({
      names: {
        [npub]: 'laeserin'
      }
    })
    expect(rows).toEqual([{ name: 'laeserin', pubkey: laeserinHex }])
  })

  it('matches npub keys when resolving entries', () => {
    const laeserinHex = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
    const npub = nip19.npubEncode(laeserinHex)
    expect(parseNip05NamePubkeyEntry(npub, 'laeserin')).toEqual({
      name: 'laeserin',
      pubkey: laeserinHex
    })
  })
})
