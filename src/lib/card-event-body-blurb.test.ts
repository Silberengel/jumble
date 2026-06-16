import { describe, expect, it } from 'vitest'
import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'

const SUBSTACK_IMG =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'
const SUBSTACK_LINK =
  'https://substackcdn.com/image/fetch/$s_!uOCe!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfa9ce52-8e34-4958-a247-1eabdd47212b_1224x816.jpeg'

describe('cardEventBodyBlurb', () => {
  it('strips nested substack image links and keeps article text', () => {
    const content = `[![](${SUBSTACK_IMG})](${SUBSTACK_LINK})Test article for posting on nostr.\n\n- Good\n  - Better\n    - Best`
    expect(cardEventBodyBlurb(content)).toBe(
      'Test article for posting on nostr. Good - Better - Best'
    )
  })

  it('strips simple markdown image syntax', () => {
    expect(cardEventBodyBlurb('![](https://example.com/a.jpg)Hello world')).toBe('Hello world')
  })
})
