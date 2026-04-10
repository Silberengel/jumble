/**
 * Check if URL is likely an image (extension or known image host).
 */
export function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i
  const imageDomains = [
    'i.nostr.build',
    'image.nostr.build',
    'nostr.build',
    'imgur.com',
    'imgur.io',
    'i.imgur.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
    'pbs.twimg.com',
    'abs.twimg.com',
    'images.unsplash.com',
    'source.unsplash.com',
    'picsum.photos',
    'via.placeholder.com',
    'placehold.co',
    'placehold.it'
  ]

  if (imageExtensions.test(url)) {
    return true
  }

  try {
    const urlObj = new URL(url)
    return imageDomains.some(
      (domain) => urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}
