const POST_SIGNUP_NAV_KEY = 'imwaldPostSignupBackupNav'
const NEW_USER_BACKUP_BANNER_KEY = 'imwaldNewUserBackupBanner'
const SKIP_NETWORK_HYDRATE_KEY = 'imwaldNewUserSkipNetworkHydrate'

export function schedulePostSignupBackupPrompt(pubkey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(POST_SIGNUP_NAV_KEY, pubkey)
}

/** Returns true when this pubkey had a pending post-signup nav (and clears it). */
export function consumePostSignupBackupPrompt(pubkey: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  const pending = sessionStorage.getItem(POST_SIGNUP_NAV_KEY)
  if (pending !== pubkey) return false
  sessionStorage.removeItem(POST_SIGNUP_NAV_KEY)
  return true
}

export function showNewUserBackupBanner(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(NEW_USER_BACKUP_BANNER_KEY, '1')
}

export function isNewUserBackupBannerVisible(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(NEW_USER_BACKUP_BANNER_KEY) === '1'
}

export function dismissNewUserBackupBanner(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(NEW_USER_BACKUP_BANNER_KEY)
}

/** Skip heavy network hydrate while local template is written and relays publish in background. */
export function markFreshSignupSkipNetworkHydrate(pubkey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(SKIP_NETWORK_HYDRATE_KEY, pubkey)
}

export function shouldSkipNetworkHydrateForFreshSignup(pubkey: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(SKIP_NETWORK_HYDRATE_KEY) === pubkey
}

export function clearFreshSignupSkipNetworkHydrate(pubkey: string): void {
  if (typeof sessionStorage === 'undefined') return
  if (sessionStorage.getItem(SKIP_NETWORK_HYDRATE_KEY) === pubkey) {
    sessionStorage.removeItem(SKIP_NETWORK_HYDRATE_KEY)
  }
}
