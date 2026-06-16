/** Third-party transcript page linked below embedded YouTube players. */
export const YOUTUBE_TRANSCRIPT_THIRD_PARTY_ORIGIN = 'https://youtubetotranscript.com'

export function buildYoutubeTranscriptThirdPartyUrl(videoId: string): string {
  return `${YOUTUBE_TRANSCRIPT_THIRD_PARTY_ORIGIN}/transcript?v=${encodeURIComponent(videoId)}`
}
