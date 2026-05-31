import { toCacheSettings } from '@/lib/link'
import {
  consumePostSignupBackupPrompt,
  showNewUserBackupBanner
} from '@/lib/post-signup-backup-prompt'
import { useSecondaryPage } from '@/contexts/secondary-page-context'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useRef } from 'react'

/** After one-click sign up, open Cache settings so the user can back up their private key. */
export default function PostSignupBackupRedirect() {
  const { push } = useSecondaryPage()
  const { pubkey } = useNostr()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!pubkey) return

    const tryRedirect = () => {
      if (!consumePostSignupBackupPrompt(pubkey)) return false
      showNewUserBackupBanner()
      push(toCacheSettings())
      return true
    }

    if (tryRedirect()) return

    // Prompt is scheduled at login; brief poll covers pubkey/login race.
    let attempts = 0
    pollRef.current = setInterval(() => {
      attempts += 1
      if (tryRedirect() || attempts >= 15) {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    }, 200)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [pubkey, push])

  return null
}
