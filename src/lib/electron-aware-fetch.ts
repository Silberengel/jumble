import { isImwaldElectron } from '@/lib/client-platform'

export type ImwaldBackendResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

/**
 * In Electron, translate / LanguageTool hit `https://…` from a loopback document origin and Chromium
 * CORS blocks them. {@link window.imwaldElectron.backendRequest} runs the same HTTP(S) call in main.
 */
export async function electronAwareFetch(input: string, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const bridge = typeof window !== 'undefined' ? window.imwaldElectron : undefined
  if (!isImwaldElectron() || typeof bridge?.backendRequest !== 'function') {
    return fetch(input, init)
  }

  const method = (init?.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    new Headers(init.headers as HeadersInit).forEach((value, key) => {
      headers[key] = value
    })
  }

  let body: string | null = null
  if (init?.body != null) {
    const b = init.body
    if (typeof b === 'string') body = b
    else if (b instanceof URLSearchParams) body = b.toString()
    else if (b instanceof ArrayBuffer) body = new TextDecoder().decode(b)
    else if (typeof Blob !== 'undefined' && b instanceof Blob) body = await b.text()
    else body = String(b)
  }

  const raw = (await bridge.backendRequest({
    url: input,
    method,
    headers,
    body
  })) as ImwaldBackendResponse

  const hdrs = new Headers()
  if (raw.headers && typeof raw.headers === 'object') {
    for (const [k, v] of Object.entries(raw.headers)) {
      if (typeof v === 'string') hdrs.set(k, v)
    }
  }

  return new Response(raw.body ?? '', {
    status: raw.status ?? 0,
    statusText: raw.statusText ?? '',
    headers: hdrs
  })
}
