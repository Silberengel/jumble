import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  loadStoredPomegranateCoordinatorUrl,
  massagePomegranateOrigin,
  normalizePomegranateCoordinatorBase,
  pomegranateGoogleLoginUrl,
  pomegranateLogin,
  PomegranateLoginCancelledError,
  storePomegranateCoordinatorUrl
} from '@/lib/pomegranate'
import { useNostr } from '@/providers/NostrProvider'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Sign in with Pomegranate: Google login at the coordinator (popup), kind-16440 setup
 * discovery, then NIP-46 bunker connect with the central as relay (no secret).
 * Mirrors imwald-android `PomegranateLoginService` / `PomegranateGoogleLoginActivity`.
 */
export default function PomegranateLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { bunkerLogin } = useNostr()
  const [coordinatorInput, setCoordinatorInput] = useState(loadStoredPomegranateCoordinatorUrl)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const abortedRef = useRef(false)

  useEffect(() => {
    return () => {
      abortedRef.current = true
    }
  }, [])

  const handleSignIn = async () => {
    setPending(true)
    setErrMsg(null)
    setStatus(t('Waiting for Google sign-in…'))
    try {
      const result = await pomegranateLogin(
        coordinatorInput,
        authenticateWithGooglePopup,
        async (discoveredCentralUrl) =>
          window.confirm(
            t(
              'An existing Pomegranate setup for this Google account was found at {{url}}. Sign in there instead?',
              { url: discoveredCentralUrl }
            )
          )
      )
      if (abortedRef.current) return
      setStatus(t('Connecting to signer…'))
      await bunkerLogin(result.bunkerUrl, { allowMissingSecret: true })
      storePomegranateCoordinatorUrl(result.centralUrl)
      if (!abortedRef.current) onLoginSuccess()
    } catch (err) {
      if (abortedRef.current) return
      if (!(err instanceof PomegranateLoginCancelledError)) {
        setErrMsg(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (!abortedRef.current) {
        setPending(false)
        setStatus(null)
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center text-muted-foreground text-sm font-semibold">
        {t('Sign in with Pomegranate')}
      </div>
      <p className="text-center text-muted-foreground text-xs px-2">
        {t(
          'Signs in to an existing Pomegranate account with Google, then connects as a NIP-46 bunker.'
        )}
      </p>

      <Button onClick={() => void handleSignIn()} disabled={pending} className="w-full">
        {pending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
        {t('Sign in with Google')}
      </Button>
      {status && !errMsg && (
        <div className="text-xs text-muted-foreground text-center">{status}</div>
      )}
      {errMsg && <div className="text-xs text-destructive text-center">{errMsg}</div>}

      <div className="grid gap-2">
        <Label htmlFor="pomegranate-coordinator-input">{t('Coordinator URL')}</Label>
        <Input
          id="pomegranate-coordinator-input"
          placeholder="https://auth.njump.me"
          value={coordinatorInput}
          onChange={(e) => setCoordinatorInput(e.target.value)}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          {t('Central server for Sign in with Pomegranate (Google + NIP-46). Default is auth.njump.me.')}
        </p>
      </div>

      <Button variant="secondary" onClick={back} className="w-full">
        {t('Back')}
      </Button>
    </div>
  )
}

/**
 * Open `{central}/login/google` in a popup and await the central token. The coordinator's
 * callback page posts `{ token }` to `window.opener` (same contract the Android WebView shims).
 */
function authenticateWithGooglePopup(centralUrl: string): Promise<string> {
  const centralOrigin = normalizePomegranateCoordinatorBase(centralUrl)
  return new Promise<string>((resolve, reject) => {
    const popup = window.open(
      pomegranateGoogleLoginUrl(centralUrl),
      'pomegranate-google-login',
      'popup=yes,width=500,height=640'
    )
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site and try again'))
      return
    }
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(closedTimer)
      fn()
    }
    const onMessage = (event: MessageEvent) => {
      if (massagePomegranateOrigin(event.origin) !== centralOrigin) return
      const token = extractToken(event.data)
      if (!token) return
      settle(() => {
        try {
          popup.close()
        } catch {
          /* already closed */
        }
        resolve(token)
      })
    }
    const closedTimer = window.setInterval(() => {
      if (popup.closed) {
        settle(() => reject(new Error('Sign-in window was closed')))
      }
    }, 500)
    window.addEventListener('message', onMessage)
  })
}

/** The callback page posts either `{ token }` or a JSON string of the same shape. */
function extractToken(data: unknown): string | null {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  const token = (data as { token?: unknown } | null)?.token
  return typeof token === 'string' && token.trim() ? token : null
}
