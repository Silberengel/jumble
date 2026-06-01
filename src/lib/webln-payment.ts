import type { GetInfoResponse, WebLNProvider } from '@webbtc/webln-types'

/** NWC clients fetch wallet service info (kind 13194) before the first NIP-47 request. */
export const NWC_WALLET_SERVICE_INFO_ERROR = 'no info event (kind 13194) returned from relay'

export function isNwcWalletServiceInfoError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NWC_WALLET_SERVICE_INFO_ERROR)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type NwcClientLike = {
  getInfo?: () => Promise<{ lud16?: string; lud06?: string }>
}

/** NIP-47 `get_info` may expose the wallet’s lud16; WebLN `getInfo()` often omits it. */
export async function resolveWalletLightningAddress(
  provider: WebLNProvider,
  info?: GetInfoResponse | null
): Promise<string | null> {
  const extended = (info ?? null) as (GetInfoResponse & { lud16?: string; lud06?: string }) | null
  if (extended?.lud16?.trim()) return extended.lud16.trim()
  if (extended?.lud06?.trim()) return extended.lud06.trim()

  const client = (provider as WebLNProvider & { client?: NwcClientLike }).client
  if (!client?.getInfo) return null

  try {
    const nip47 = await client.getInfo()
    if (nip47.lud16?.trim()) return nip47.lud16.trim()
    if (nip47.lud06?.trim()) return nip47.lud06.trim()
  } catch {
    /* wallet did not report a receive address */
  }
  return null
}

/** Enable WebLN and load wallet info so NWC encryption is negotiated before paying. */
export async function prepareConnectedWebLNProvider(
  provider: WebLNProvider
): Promise<{ info: GetInfoResponse; walletLightningAddress: string | null }> {
  await provider.enable()
  const info = await provider.getInfo()
  const walletLightningAddress = await resolveWalletLightningAddress(provider, info)
  return { info, walletLightningAddress }
}

export async function sendWebLNPaymentWithRetry(
  provider: WebLNProvider,
  invoice: string,
  maxAttempts = 3
): Promise<{ preimage: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        try {
          await provider.getInfo()
        } catch {
          // Warm-up only; sendPayment below reports the actionable error.
        }
      }
      return await provider.sendPayment(invoice)
    } catch (error) {
      lastError = error
      if (!isNwcWalletServiceInfoError(error) || attempt === maxAttempts - 1) {
        throw error
      }
      await delay(400 * (attempt + 1))
    }
  }
  throw lastError
}

const DEFAULT_WEBLN_PAYMENT_TIMEOUT_MS = 90_000

/** Same as {@link sendWebLNPaymentWithRetry} but rejects when the wallet never responds. */
export async function sendWebLNPaymentWithRetryAndTimeout(
  provider: WebLNProvider,
  invoice: string,
  options?: { maxAttempts?: number; timeoutMs?: number }
): Promise<{ preimage: string }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WEBLN_PAYMENT_TIMEOUT_MS
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      sendWebLNPaymentWithRetry(provider, invoice, options?.maxAttempts ?? 3),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Wallet payment timed out')),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
