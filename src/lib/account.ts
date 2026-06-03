import { hexPubkeysEqual, isValidPubkey, normalizeHexPubkey } from '@/lib/pubkey'
import { TAccountPointer, TSignerType } from '@/types'

export function isSameAccount(a: TAccountPointer | null, b: TAccountPointer | null) {
  if (!a || !b) return false
  if (a.signerType !== b.signerType) return false
  return hexPubkeysEqual(normalizeHexPubkey(a.pubkey), normalizeHexPubkey(b.pubkey))
}

/** Same hex pubkey, regardless of signer type (e.g. npub vs nip-07 rows). */
export function isSameAccountPubkey(a: TAccountPointer | null, b: TAccountPointer | null) {
  if (!a || !b) return false
  return hexPubkeysEqual(normalizeHexPubkey(a.pubkey), normalizeHexPubkey(b.pubkey))
}

/** False when the user should be allowed to pick this row (e.g. reconnect nip-07 while read-only). */
export function isRedundantAccountPick(target: TAccountPointer, session: TAccountPointer | null) {
  if (!session) return false
  if (isSameAccount(target, session)) return true
  if (
    session.signerType === 'npub' &&
    target.signerType === 'npub' &&
    isSameAccountPubkey(target, session)
  ) {
    return true
  }
  return false
}

const SWITCH_SIGNER_PRIORITY: Record<TSignerType, number> = {
  'nip-07': 0,
  nsec: 1,
  'browser-nsec': 1,
  ncryptsec: 2,
  bunker: 3,
  npub: 4
}

function normalizedPubkeyHex(account: TAccountPointer): string | null {
  const raw = account.pubkey?.trim()
  if (!raw) return null
  const pk = normalizeHexPubkey(raw)
  return isValidPubkey(pk) ? pk : null
}

/**
 * One entry per pubkey for account switcher chips — keeps every identity that has logged in,
 * and prefers a signable signer when the same pubkey has both npub and nip-07 rows.
 */
export function listSwitchableAccounts(accounts: readonly TAccountPointer[]): TAccountPointer[] {
  const byPubkey = new Map<string, TAccountPointer>()
  for (const a of accounts) {
    const pk = normalizedPubkeyHex(a)
    if (!pk) continue
    const row: TAccountPointer = { pubkey: pk, signerType: a.signerType }
    const existing = byPubkey.get(pk)
    if (!existing) {
      byPubkey.set(pk, row)
      continue
    }
    const curPri = SWITCH_SIGNER_PRIORITY[a.signerType] ?? 99
    const exPri = SWITCH_SIGNER_PRIORITY[existing.signerType] ?? 99
    if (curPri < exPri) {
      byPubkey.set(pk, row)
    }
  }
  return Array.from(byPubkey.values())
}

export function accountPointerKey(account: TAccountPointer): string {
  const pk = normalizedPubkeyHex(account)
  return pk ? `${pk}:${account.signerType}` : account.signerType
}
