import { hexPubkeysEqual } from '@/lib/pubkey'
import { isSameAccount } from '@/lib/account'
import type { TAccount } from '@/types'

/** Prefer signable fields from `fallback` when `primary` is missing them. */
export function mergeAccountSecrets(primary: TAccount, fallback: TAccount): TAccount {
  const out: TAccount = { ...primary }

  if (
    (out.signerType === 'nsec' || out.signerType === 'browser-nsec') &&
    !out.nsec &&
    fallback.nsec
  ) {
    out.nsec = fallback.nsec
    if (out.signerType === 'browser-nsec') {
      out.signerType = 'nsec'
    }
  }

  if (out.signerType === 'ncryptsec' && !out.ncryptsec && fallback.ncryptsec) {
    out.ncryptsec = fallback.ncryptsec
  }

  if (out.signerType === 'bunker') {
    if (!out.bunker && fallback.bunker) out.bunker = fallback.bunker
    if (!out.bunkerClientSecretKey && fallback.bunkerClientSecretKey) {
      out.bunkerClientSecretKey = fallback.bunkerClientSecretKey
    }
  }

  if (out.signerType === 'npub' && !out.npub && fallback.npub) {
    out.npub = fallback.npub
  }

  return out
}

function parseAccountsJson(json: string | undefined): TAccount[] | null {
  if (json == null) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? (parsed as TAccount[]) : null
  } catch {
    return null
  }
}

function findAccountMatch(accounts: readonly TAccount[], target: TAccount): TAccount | undefined {
  return (
    accounts.find((a) => isSameAccount(a, target)) ??
    accounts.find((a) => hexPubkeysEqual(a.pubkey, target.pubkey))
  )
}

/** Merge account rows from IndexedDB and localStorage, preserving secrets from either source. */
export function mergeAccountsSettingsJson(
  idbJson: string | undefined,
  lsJson: string | undefined
): string | undefined {
  const idbAccounts = parseAccountsJson(idbJson)
  const lsAccounts = parseAccountsJson(lsJson)

  if (!idbAccounts?.length && !lsAccounts?.length) {
    return idbJson ?? lsJson
  }
  if (!idbAccounts?.length) return lsJson
  if (!lsAccounts?.length) return idbJson

  const merged: TAccount[] = idbAccounts.map((idbAcc) => {
    const lsAcc = findAccountMatch(lsAccounts, idbAcc)
    return lsAcc ? mergeAccountSecrets(idbAcc, lsAcc) : idbAcc
  })

  for (const lsAcc of lsAccounts) {
    if (!merged.some((a) => isSameAccount(a, lsAcc))) {
      merged.push(lsAcc)
    }
  }

  return JSON.stringify(merged)
}

export function mergeCurrentAccountSettingsJson(
  idbJson: string | undefined,
  lsJson: string | undefined
): string | undefined {
  if (idbJson == null && lsJson == null) return undefined
  if (idbJson == null) return lsJson
  if (lsJson == null) return idbJson

  let idbAcc: TAccount | null = null
  let lsAcc: TAccount | null = null
  try {
    idbAcc = JSON.parse(idbJson) as TAccount | null
  } catch {
    return lsJson
  }
  try {
    lsAcc = JSON.parse(lsJson) as TAccount | null
  } catch {
    return idbJson
  }

  if (!idbAcc) return lsJson
  if (!lsAcc) return idbJson
  if (!isSameAccount(idbAcc, lsAcc) && !hexPubkeysEqual(idbAcc.pubkey, lsAcc.pubkey)) {
    return idbJson
  }

  return JSON.stringify(mergeAccountSecrets(idbAcc, lsAcc))
}
