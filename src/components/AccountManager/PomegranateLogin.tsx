import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  authenticateWithGooglePopup,
  decodePomegranateGoogleToken,
  loadStoredPomegranateCoordinatorUrl,
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
 * Sign in with Pomegranate.
 *
 * Google’s COOP usually clears `window.opener`, so the coordinator callback cannot
 * `postMessage` the token back. Flow: open Google once → paste token from the auth page
 * (even when it shows “Error: No token received.” — `document.body.dataset.token` is still set).
 * A background popup listener still accepts a lucky postMessage if opener survives.
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
  const [awaitingPaste, setAwaitingPaste] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [manualToken, setManualToken] = useState('')
  const abortedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortedRef.current = true
      abortRef.current?.abort()
    }
  }, [])

  const runWithToken = async (rawToken: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    abortedRef.current = false
    setPending(true)
    setErrMsg(null)
    setAwaitingPaste(true)
    setStatus(t('Loading Pomegranate account…', { defaultValue: 'Loading Pomegranate account…' }))
    try {
      const result = await pomegranateLogin(
        coordinatorInput,
        async () => rawToken,
        async (discoveredCentralUrl) =>
          window.confirm(
            t(
              'An existing Pomegranate setup for this Google account was found at {{url}}. Sign in there instead?',
              { url: discoveredCentralUrl }
            )
          ),
        {
          signal: ac.signal,
          onProgress: (message) => {
            if (!abortedRef.current && !ac.signal.aborted) setStatus(message)
          }
        }
      )
      if (abortedRef.current || ac.signal.aborted) throw new PomegranateLoginCancelledError()
      setStatus(t('Connecting to signer…'))
      await bunkerLogin(result.bunkerUrl, { allowMissingSecret: true, timeoutMs: 25_000 })
      storePomegranateCoordinatorUrl(result.centralUrl)
      if (!abortedRef.current && !ac.signal.aborted) onLoginSuccess()
    } catch (err) {
      if (abortedRef.current || ac.signal.aborted) return
      if (err instanceof PomegranateLoginCancelledError) return
      setErrMsg(err instanceof Error ? err.message : String(err))
      setAwaitingPaste(true)
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      if (!abortedRef.current) {
        setPending(false)
        setStatus(null)
      }
    }
  }

  const pasteHint = () =>
    t('pomegranatePasteAfterGoogle', {
      defaultValue:
        'A Google tab should open. Finish sign-in there. When it says “Error: No token received.” that usually means success — in THAT tab’s console run: copy(document.body.dataset.token) — paste below. Do not refresh that page.'
    })

  const handleSignIn = () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setErrMsg(null)
    setManualToken('')
    setAwaitingPaste(true)
    setPending(false)
    setStatus(pasteHint())

    // Opens a normal tab (not a tiny popup). postMessage rarely works after Google COOP;
    // paste is the reliable path. We still listen in case opener survives.
    void authenticateWithGooglePopup(coordinatorInput, { signal: ac.signal })
      .then((token) => {
        if (abortedRef.current || ac.signal.aborted) return
        void runWithToken(token)
      })
      .catch((err) => {
        if (abortedRef.current || ac.signal.aborted) return
        if (err instanceof PomegranateLoginCancelledError) return
        // Keep paste UI; surface the real reason (blocked / closed / timeout).
        setErrMsg(err instanceof Error ? err.message : String(err))
        setStatus(pasteHint())
      })
  }

  const handleOpenTabOnly = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setErrMsg(null)
    setAwaitingPaste(true)
    setPending(false)
    setStatus(pasteHint())
    window.open(pomegranateGoogleLoginUrl(coordinatorInput), '_blank')
  }

  const handleCancel = () => {
    abortedRef.current = true
    abortRef.current?.abort()
    abortRef.current = null
    setPending(false)
    setAwaitingPaste(false)
    setStatus(null)
    setErrMsg(null)
  }

  const handleManualContinue = () => {
    const raw = manualToken.trim()
    if (!raw) return
    try {
      decodePomegranateGoogleToken(raw)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
      return
    }
    void runWithToken(raw)
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

      <Button onClick={handleSignIn} disabled={pending} className="w-full">
        {pending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
        {t('Sign in with Google')}
      </Button>
      {(pending || awaitingPaste) && (
        <Button variant="outline" onClick={handleCancel} className="w-full">
          {t('Cancel')}
        </Button>
      )}
      {status && !errMsg && (
        <div className="text-xs text-muted-foreground text-center">{status}</div>
      )}
      {errMsg && <div className="text-xs text-destructive text-center">{errMsg}</div>}

      <div className="grid gap-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">
          {t('pomegranateManualTokenHint', {
            defaultValue:
              'After Google, auth.njump.me often shows “Error: No token received.” — the token is still there. In that tab’s console: copy(document.body.dataset.token), paste below. Never refresh that page.'
          })}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={handleOpenTabOnly}
          disabled={pending}
          className="w-full"
        >
          {t('Open Google login tab', { defaultValue: 'Open Google login in new tab' })}
        </Button>
        <Label htmlFor="pomegranate-manual-token">
          {t('Paste sign-in token', { defaultValue: 'Paste sign-in token' })}
        </Label>
        <Textarea
          id="pomegranate-manual-token"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="base64…"
          className="min-h-[4.5rem] font-mono text-xs"
          disabled={pending}
        />
        <Button
          variant="secondary"
          onClick={handleManualContinue}
          disabled={pending || !manualToken.trim()}
          className="w-full"
        >
          {pending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          {t('Continue with token', { defaultValue: 'Continue with token' })}
        </Button>
      </div>

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

      <Button variant="secondary" onClick={back} className="w-full" disabled={pending}>
        {t('Back')}
      </Button>
    </div>
  )
}
