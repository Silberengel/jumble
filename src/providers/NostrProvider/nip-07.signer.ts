import { pubkeyFromNip07Extension } from '@/lib/pubkey'
import { ISigner, TDraftEvent, TNip07 } from '@/types'

/** Poll interval while waiting for a NIP-07 extension to inject `window.nostr`. */
export const NIP07_INJECT_CHECK_INTERVAL_MS = 100
/** Some mobile browsers inject the extension API well after first paint. */
export const NIP07_INJECT_MAX_ATTEMPTS = 120

/** Fresh extension pubkey (hex), after init + optional enable. */
export async function getExtensionPubkeyHex(): Promise<string> {
  const signer = new Nip07Signer()
  await signer.init()
  const raw = await signer.getPublicKey()
  const hex = pubkeyFromNip07Extension(raw)
  if (!hex) {
    throw new Error(
      raw
        ? 'Extension returned an invalid pubkey'
        : 'You did not allow the extension to access your pubkey'
    )
  }
  return hex
}

export class Nip07Signer implements ISigner {
  private signer: TNip07 | undefined
  private pubkey: string | null = null

  async init() {
    for (let attempt = 0; attempt < NIP07_INJECT_MAX_ATTEMPTS; attempt++) {
      if (window.nostr) {
        this.signer = window.nostr
        if (typeof this.signer.enable === 'function') {
          await this.signer.enable()
        }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, NIP07_INJECT_CHECK_INTERVAL_MS))
    }

    throw new Error(
      'You need to install a nostr signer extension to login. Such as alby, nostr-keyx or nos2x.'
    )
  }

  async getPublicKey() {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    /** Always ask the extension — it may change the active key without a full page reload. */
    this.pubkey = await this.signer.getPublicKey()
    return this.pubkey
  }

  async signEvent(draftEvent: TDraftEvent) {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    return await this.signer.signEvent(draftEvent)
  }

  async nip04Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    if (!this.signer.nip04?.encrypt) {
      throw new Error('The extension you are using does not support nip04 encryption')
    }
    return await this.signer.nip04.encrypt(pubkey, plainText)
  }

  async nip04Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    if (!this.signer.nip04?.decrypt) {
      throw new Error('The extension you are using does not support nip04 decryption')
    }
    return await this.signer.nip04.decrypt(pubkey, cipherText)
  }

  async nip44Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    if (!this.signer.nip44?.encrypt) {
      throw new Error('The extension you are using does not support nip44 encryption')
    }
    return await this.signer.nip44.encrypt(pubkey, plainText)
  }

  async nip44Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Should call init() first')
    }
    if (!this.signer.nip44?.decrypt) {
      throw new Error('The extension you are using does not support nip44 decryption')
    }
    return await this.signer.nip44.decrypt(pubkey, cipherText)
  }
}
