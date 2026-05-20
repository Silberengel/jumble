import { describe, expect, it } from 'vitest'
import {
  buildPublicMessagePublishRelayUrls,
  collectRecipientInboxUrls,
  collectSenderOutboxUrls
} from './public-message-publish-relays'

describe('public-message-publish-relays', () => {
  it('collects sender outbox and recipient inbox only', () => {
    expect(
      collectSenderOutboxUrls({
        write: ['wss://sender-out.example/'],
        read: ['wss://sender-in.example/'],
        httpWrite: ['https://sender-http.example/'],
        httpRead: ['https://sender-http-in.example/'],
        originalRelays: [],
        httpOriginalRelays: []
      })
    ).toEqual(['https://sender-http.example/', 'wss://sender-out.example/'])

    expect(
      collectRecipientInboxUrls({
        write: ['wss://recipient-out.example/'],
        read: ['wss://recipient-in.example/'],
        httpWrite: [],
        httpRead: ['https://recipient-http-in.example/'],
        originalRelays: [],
        httpOriginalRelays: []
      })
    ).toEqual(['https://recipient-http-in.example/', 'wss://recipient-in.example/'])
  })

  it('orders author outbox before recipient inbox', () => {
    const urls = buildPublicMessagePublishRelayUrls(
      ['wss://sender-out.example/'],
      ['wss://recipient-in.example/']
    )
    expect(urls).toEqual(['wss://sender-out.example/', 'wss://recipient-in.example/'])
  })
})
