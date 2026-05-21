import type { GetInfoResponse, WebLNProvider } from '@webbtc/webln-types'

/** NWC clients fetch wallet service info (kind 13194) before the first NIP-47 request. */
export const NWC_WALLET_SERVICE_INFO_ERROR = 'no info event (kind 13194) returned from relay'

export function isNwcWalletServiceInfoError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NWC_WALLET_SERVICE_INFO_ERROR)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Enable WebLN and load wallet info so NWC encryption is negotiated before paying. */
export async function prepareConnectedWebLNProvider(
  provider: WebLNProvider
): Promise<GetInfoResponse> {
  await provider.enable()
  return provider.getInfo()
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
