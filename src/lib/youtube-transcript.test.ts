import { describe, expect, it } from 'vitest'
import { buildYoutubeTranscriptThirdPartyUrl } from './youtube-transcript'

describe('youtube-transcript', () => {
  it('builds third-party transcript URL', () => {
    expect(buildYoutubeTranscriptThirdPartyUrl('abc123xyz01')).toBe(
      'https://youtubetotranscript.com/transcript?v=abc123xyz01'
    )
  })
})
