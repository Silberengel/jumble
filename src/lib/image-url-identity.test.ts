import { describe, expect, it } from 'vitest'
import {
  collectMediaUrlKeysInText,
  getImageUrlIdentity,
  imageIdentitySetKey,
  isImageUrlPresentInText
} from '@/lib/image-url-identity'

const SUBSTACK_TAG_IMAGE =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'

const SUBSTACK_CONTENT_LINK =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'

const SUBSTACK_CONTENT_SRC =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'

describe('getImageUrlIdentity', () => {
  it('matches Substack CDN variants of the same S3 object', () => {
    const idTag = getImageUrlIdentity(SUBSTACK_TAG_IMAGE)
    const idLink = getImageUrlIdentity(SUBSTACK_CONTENT_LINK)
    expect(idTag).toBe('cfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg')
    expect(idLink).toBe(idTag)
  })
})

describe('isImageUrlPresentInText', () => {
  it('detects image tag URL when markdown content embeds the same asset', () => {
    const content = `[![](${SUBSTACK_CONTENT_SRC})](${SUBSTACK_CONTENT_LINK})Test article`
    expect(isImageUrlPresentInText(content, SUBSTACK_TAG_IMAGE)).toBe(true)
  })

  it('collects identity keys for content images', () => {
    const content = `![](${SUBSTACK_CONTENT_LINK})`
    const keys = collectMediaUrlKeysInText(content)
    expect(keys.has(imageIdentitySetKey('cfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'))).toBe(
      true
    )
  })
})
