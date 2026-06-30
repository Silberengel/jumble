import { Button } from '@/components/ui/button'
import { MessageCircle, RotateCw } from 'lucide-react'
import React, { Component, ReactNode } from 'react'
import { toast } from 'sonner'
import { clearAppServiceWorkerAndCaches } from '@/lib/app-cache-maintenance'
import logger from '@/lib/logger'
import { isChunkLoadFailureMessage, tryStaleChunkReloadOnce } from '@/lib/stale-chunk-recovery'

const ISSUES_URL =
  'https://gitrepublic.imwald.eu/repos/npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z/imwald?tab=issues'

/**
 * React context hooks throw when provider/consumer modules disagree (HMR, or PWA serving mixed
 * deploy chunks). One cache-busting reload usually fixes it.
 */
const CONTEXT_RECOVERY_RELOAD_KEY = 'jumble-context-recovery-reload-at'
const CONTEXT_RECOVERY_COOLDOWN_MS = 20_000

function isLikelyBrokenReactContext(message: string): boolean {
  return (
    /must be used within (a )?[\w]+/i.test(message) ||
    message.includes('useNostr must be used within') ||
    message.includes('useContentPolicy must be used within') ||
    message.includes('useInterestList must be used within') ||
    message.includes('useCacheBrowser must be used within') ||
    (message.includes('useContext') && message.includes('null'))
  )
}

/** Avoid double `reload()` when React StrictMode runs render twice before navigation. */
let contextRecoveryReloadScheduled = false

function tryContextRecoveryReload(): boolean {
  if (typeof window === 'undefined') return false
  if (contextRecoveryReloadScheduled) return true
  try {
    const last = Number(sessionStorage.getItem(CONTEXT_RECOVERY_RELOAD_KEY) || '0')
    const now = Date.now()
    if (now - last <= CONTEXT_RECOVERY_COOLDOWN_MS) return false
    sessionStorage.setItem(CONTEXT_RECOVERY_RELOAD_KEY, String(now))
    contextRecoveryReloadScheduled = true
    void (async () => {
      if (!import.meta.env.DEV) {
        try {
          await clearAppServiceWorkerAndCaches()
        } catch (error) {
          logger.warn('[ErrorBoundary] Service worker cache clear before context recovery failed', {
            error
          })
        }
      }
      window.location.reload()
    })()
    return true
  } catch {
    return false
  }
}

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught an error', { error, errorInfo })
    // Recovery reload runs in render() so navigation starts before the error UI paints.
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message ?? ''
      if (isChunkLoadFailureMessage(msg) && tryStaleChunkReloadOnce()) {
        return (
          <div className="flex h-screen w-screen items-center justify-center p-4 text-muted-foreground">
            Reloading to pick up the latest app version…
          </div>
        )
      }
      if (isLikelyBrokenReactContext(msg) && tryContextRecoveryReload()) {
        return (
          <div className="flex h-screen w-screen items-center justify-center p-4 text-muted-foreground">
            {import.meta.env.DEV
              ? 'Reloading after a dev hot-reload glitch…'
              : 'Reloading to pick up a consistent app version…'}
          </div>
        )
      }
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center p-4 gap-4">
          <h1 className="text-2xl font-bold">Oops, something went wrong.</h1>
          <p className="text-lg text-center max-w-md">
            Sorry for the inconvenience. You can help by logging an issue with the error details.
          </p>
          {this.state.error?.message && (
            <>
              <div className="flex gap-2">
                <Button asChild className="bg-primary text-primary-foreground">
                  <a
                    href={ISSUES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Report issue
                  </a>
                </Button>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(this.state.error!.message)
                    toast.success('Error message copied to clipboard')
                  }}
                  variant="secondary"
                >
                  Copy Error Message
                </Button>
              </div>
              <pre className="bg-destructive/10 text-destructive p-2 rounded text-wrap break-words whitespace-pre-wrap">
                Error: {this.state.error.message}
              </pre>
            </>
          )}
          <Button
            onClick={() => {
              try {
                sessionStorage.removeItem(CONTEXT_RECOVERY_RELOAD_KEY)
              } catch {
                /* ignore */
              }
              window.location.reload()
            }}
            className="mt-2"
          >
            <RotateCw className="w-4 h-4 mr-2" />
            Reload Page
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
