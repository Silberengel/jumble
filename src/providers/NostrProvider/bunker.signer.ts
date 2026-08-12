import { ISigner, TDraftEvent } from '@/types'
import { openBunkerAuthUrl } from '@/lib/bunker-auth-url'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { generateSecretKey } from 'nostr-tools'
import { BunkerSigner as NBunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'

/** Default wait for NIP-46 `connect` + `get_public_key` (nostr-tools has no built-in timeout). */
export const BUNKER_CONNECT_TIMEOUT_MS = 25_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export class BunkerSigner implements ISigner {
  signer: NBunkerSigner | null = null
  private clientSecretKey: Uint8Array
  private pubkey: string | null = null

  constructor(clientSecretKey?: string) {
    this.clientSecretKey = clientSecretKey ? hexToBytes(clientSecretKey) : generateSecretKey()
  }

  async login(
    bunker: string,
    isInitialConnection = true,
    options?: {
      /** Pomegranate handler bunkers omit `secret` by design; connect with an empty secret. */
      allowMissingSecret?: boolean
      /** Override {@link BUNKER_CONNECT_TIMEOUT_MS}. */
      timeoutMs?: number
    }
  ): Promise<string> {
    const bunkerPointer = await parseBunkerInput(bunker)
    if (!bunkerPointer) {
      throw new Error('Invalid bunker')
    }
    if (isInitialConnection && !bunkerPointer.secret && !options?.allowMissingSecret) {
      throw new Error(
        'This bunker URI has no secret. In Amber, create a bunker connection and paste the full bunker:// link (including &secret=…).'
      )
    }

    this.signer = NBunkerSigner.fromBunker(this.clientSecretKey, bunkerPointer, {
      onauth: (url) => {
        openBunkerAuthUrl(url)
      }
    })
    if (isInitialConnection) {
      // auth.njump.me only delivers NIP-46 responses on the same websocket that published the
      // request. Wait until the pool relay is up, then re-subscribe so the filter is on that socket.
      const pool = this.signer.pool
      await Promise.all(
        bunkerPointer.relays.map(async (url) => {
          try {
            await pool.ensureRelay(url, { connectionTimeout: 12_000 })
          } catch {
            throw new Error(`Could not open bunker relay ${url}`)
          }
        })
      )
      try {
        this.signer.subCloser?.close()
      } catch {
        /* ignore */
      }
      this.signer.subCloser = undefined
      this.signer.setupSubscription()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200))

      const timeoutMs = options?.timeoutMs ?? BUNKER_CONNECT_TIMEOUT_MS
      try {
        await withTimeout(
          this.signer.connect(),
          timeoutMs,
          'Timed out connecting to the remote signer. Check that auth.njump.me is reachable and try again.'
        )
      } catch (err) {
        try {
          await this.signer.close()
        } catch {
          /* ignore */
        }
        this.signer = null
        throw err
      }
    }
    try {
      this.pubkey = await withTimeout(
        this.signer.getPublicKey(),
        options?.timeoutMs ?? BUNKER_CONNECT_TIMEOUT_MS,
        'Timed out reading the public key from the remote signer. Try again.'
      )
    } catch (err) {
      try {
        await this.signer.close()
      } catch {
        /* ignore */
      }
      this.signer = null
      throw err
    }
    return this.pubkey
  }

  async getPublicKey() {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    if (!this.pubkey) {
      this.pubkey = await this.signer.getPublicKey()
    }
    return this.pubkey
  }

  async signEvent(draftEvent: TDraftEvent) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return this.signer.signEvent(draftEvent)
  }

  async nip04Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip04Encrypt(pubkey, plainText)
  }

  async nip04Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip04Decrypt(pubkey, cipherText)
  }

  async nip44Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip44Encrypt(pubkey, plainText)
  }

  async nip44Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip44Decrypt(pubkey, cipherText)
  }

  getClientSecretKey() {
    return bytesToHex(this.clientSecretKey)
  }
}
