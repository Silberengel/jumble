export class PromiseTimeoutError extends Error {
  constructor(message = 'Promise timed out') {
    super(message)
    this.name = 'PromiseTimeoutError'
  }
}

export function isPromiseTimeoutError(err: unknown): err is PromiseTimeoutError {
  return err instanceof PromiseTimeoutError
}

/** Rejects with {@link PromiseTimeoutError} when `promise` does not settle within `ms`. */
export async function racePromiseWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new PromiseTimeoutError(label ?? `Timed out after ${ms}ms`))
        }, ms)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
