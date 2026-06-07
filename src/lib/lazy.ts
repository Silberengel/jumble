export enum LazyStatus {
  Pending,
  Resolved,
  Error
}

export class Lazy<T> {
  #value: T | null = null
  #resolver: () => Promise<T>
  #pendingPromise: Promise<T | null> | null = null

  status: LazyStatus

  constructor(resolver: () => Promise<T>) {
    this.#resolver = resolver
    this.status = LazyStatus.Pending
  }

  value(): Promise<T | null> {
    if (this.status === LazyStatus.Resolved) {
      return Promise.resolve(this.#value)
    }

    if (this.status === LazyStatus.Error) {
      return Promise.resolve(null)
    }

    if (this.#pendingPromise) {
      return this.#pendingPromise
    }

    this.#pendingPromise = this.#resolve()
    return this.#pendingPromise
  }

  async #resolve(): Promise<T | null> {
    try {
      this.#value = await this.#resolver()
      this.status = LazyStatus.Resolved
      return this.#value
    } catch {
      this.status = LazyStatus.Error
      return null
    } finally {
      this.#pendingPromise = null
    }
  }
}
