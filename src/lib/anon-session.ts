import { NsecSigner } from '@/providers/NostrProvider/nsec.signer'
import type { TAccountPointer } from '@/types'
import { generateSecretKey } from 'nostr-tools'

/** Sentinel pubkey for the anonymous write session (not a real key). */
export const ANON_ACCOUNT_PUBKEY = '__anon__'

const ANON_SESSION_STORAGE_KEY = 'jumble-anon-session'

export function createAnonAccountPointer(): TAccountPointer {
  return { pubkey: ANON_ACCOUNT_PUBKEY, signerType: 'anon' }
}

export function isAnonAccount(account: TAccountPointer | null | undefined): boolean {
  return account?.signerType === 'anon'
}

export function isAnonSessionPersisted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(ANON_SESSION_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setAnonSessionPersisted(active: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (active) sessionStorage.setItem(ANON_SESSION_STORAGE_KEY, '1')
    else sessionStorage.removeItem(ANON_SESSION_STORAGE_KEY)
  } catch {
    // ignore quota / private browsing
  }
}

/** Fresh nsec signer — new keypair on every call. */
export function createEphemeralSigner(): NsecSigner {
  const signer = new NsecSigner()
  signer.login(generateSecretKey())
  return signer
}
