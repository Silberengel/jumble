import { describe, expect, it } from 'vitest'
import { mergePaymentMethods, normalizeLightningAuthority } from './merge-payment-methods'

describe('normalizeLightningAuthority', () => {
  it('maps dot variant to user@domain', () => {
    expect(normalizeLightningAuthority('User.Name@Example.COM')).toBe('user.name@example.com')
    expect(normalizeLightningAuthority('user.name@example.com')).toBe('user.name@example.com')
  })
})

describe('mergePaymentMethods lightning dedup', () => {
  it('keeps payto URI in sync when authority is canonicalized on merge', () => {
    const methods = mergePaymentMethods(
      {
        methods: [
          {
            type: 'lightning',
            authority: 'user.domain',
            payto: 'payto://lightning/user.domain',
            displayType: 'Lightning Network'
          },
          {
            type: 'lightning',
            authority: 'user@domain',
            payto: 'payto://lightning/user@domain',
            displayType: 'Lightning Network'
          }
        ]
      },
      null
    )

    expect(methods).toHaveLength(1)
    expect(methods[0].authority).toBe('user@domain')
    expect(methods[0].payto).toBe('payto://lightning/user%40domain')
  })
})
