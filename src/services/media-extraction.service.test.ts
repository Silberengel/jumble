import { ExtendedKind } from '@/constants'
import { mediaPosterUrlFromImeta } from '@/lib/imeta-display'
import { extractAllMediaFromEvent } from '@/services/media-extraction.service'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

describe('extractAllMediaFromEvent', () => {
  it('merges imeta poster onto blossom content URL via x tag', () => {
    const hash = 'a4cdb7f9adb8800e5c776900bee6670482fee585fd78fbe888e558d059efa305'
    const blossom = `https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/${hash}.mp4`
    const nostrBuild = 'https://v.nostr.build/0lLUd9zqfNdIz7py.mp4'
    const poster =
      'https://npub1gluh6ns2vsxg493a87n3m8c2d2ketzh62p07lhkad4ffaaqj9mesu6d3sz.blossom.band/9118b05ce1b093a41fa3f8796ff82350ab3f9c9dc24c289f1889f5c28828706b.jpg'

    const event: Event = {
      kind: ExtendedKind.SHORT_VIDEO,
      id: '27e20f85d6f1b443c9bfefa215ae6c4e943547aaea3c8c3864423944248ed2c4',
      pubkey: '47f97d4e0a640c8a963d3fa71d9f0a6aad958afa505fefdedd6d529ef4122ef3',
      created_at: 1781586619,
      content: `Posting this with blossom.band\n${blossom}`,
      sig: 'sig',
      tags: [
        [
          'imeta',
          `url ${nostrBuild}`,
          'm video/mp4',
          `x ${hash}`,
          `ox ${hash}`,
          'blurhash L56HfjR+Eg%2_NWVwc%2^*w^S4OY',
          `thumb ${nostrBuild}`,
          `image ${poster}`
        ]
      ]
    }

    const extracted = extractAllMediaFromEvent(event)
    const contentVideo = extracted.videos.find((v) => v.url === blossom)
    expect(contentVideo).toBeDefined()
    expect(contentVideo?.image).toBe(poster)
    expect(mediaPosterUrlFromImeta(contentVideo)).toBe(poster)
  })
})
