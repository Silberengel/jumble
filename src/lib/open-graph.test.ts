import { describe, expect, it } from 'vitest'
import {
  htmlLooksLikeImwaldAppShell,
  isImwaldDefaultOpenGraphDescription,
  isImwaldDefaultOpenGraphTitle,
  parseOpenGraphFromHtml
} from './open-graph'

const IMWALD_INDEX_SNIPPET = `<!doctype html>
<html><head>
<title>Imwald</title>
<meta property="og:title" content="Imwald" />
<meta property="og:description" content="Imwald — a user-friendly Nostr client focused on relay feed browsing, publications, and relay discovery." />
<meta property="og:image" content="https://jumble.imwald.eu/og-image.png" />
</head><body><div id="root"><div id="imwald-boot-splash"></div></div></body></html>`

const FOUNTAIN_SNIPPET = `<!doctype html>
<html><head>
<meta property="og:title" content="Episode Title | Fountain" />
<meta property="og:description" content="A podcast episode" />
<meta property="og:image" content="https://fountain.fm/cover.jpg" />
<meta property="og:audio" content="https://fountain.fm/audio.mp3" />
</head><body></body></html>`

describe('open-graph', () => {
  it('detects Imwald app shell HTML', () => {
    expect(htmlLooksLikeImwaldAppShell(IMWALD_INDEX_SNIPPET)).toBe(true)
    expect(htmlLooksLikeImwaldAppShell(FOUNTAIN_SNIPPET)).toBe(false)
  })

  it('returns empty metadata for app shell on external URLs', () => {
    expect(parseOpenGraphFromHtml(IMWALD_INDEX_SNIPPET, 'https://fountain.fm/episode/x')).toEqual({})
  })

  it('parses og and twitter tags from a normal page', () => {
    expect(parseOpenGraphFromHtml(FOUNTAIN_SNIPPET, 'https://fountain.fm/episode/x')).toEqual({
      title: 'Episode Title | Fountain',
      description: 'A podcast episode',
      image: 'https://fountain.fm/cover.jpg',
      audio: 'https://fountain.fm/audio.mp3'
    })
  })

  it('strips Imwald default title even without trailing space', () => {
    expect(isImwaldDefaultOpenGraphTitle('Imwald')).toBe(true)
    expect(isImwaldDefaultOpenGraphTitle('Episode Title')).toBe(false)
  })

  it('strips Imwald default description case-insensitively', () => {
    expect(
      isImwaldDefaultOpenGraphDescription(
        'Imwald — a user-friendly Nostr client focused on relay feed browsing.'
      )
    ).toBe(true)
  })

  it('filters jumble og-image on external hosts while keeping other fields', () => {
    const html = `<html><head>
<meta property="og:title" content="Real Site" />
<meta property="og:description" content="About the site" />
<meta property="og:image" content="https://jumble.imwald.eu/og-image.png" />
</head></html>`
    expect(parseOpenGraphFromHtml(html, 'https://example.com/page')).toEqual({
      title: 'Real Site',
      description: 'About the site',
      image: undefined,
      audio: undefined
    })
  })
})
