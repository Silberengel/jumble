import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useHiddenNetworkRelayStatus } from '@/hooks/useHiddenNetworkRelayStatus'
import type { HiddenNetworkSocksEndpointStatus, HiddenNetworkRelayStatus } from '@/lib/hidden-network-relay-status'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function endpointSourceLabel(
  t: (key: string) => string,
  endpoint: HiddenNetworkSocksEndpointStatus
): string {
  switch (endpoint.source) {
    case 'env':
      return t('hiddenNetworkSocksSourceEnv')
    case 'daemon':
      return t('hiddenNetworkSocksSourceTorDaemon')
    case 'tor-browser':
      return t('hiddenNetworkSocksSourceTorBrowser')
    case 'router':
      return t('hiddenNetworkSocksSourceI2pRouter')
    default:
      return t('hiddenNetworkSocksSourceUnavailable')
  }
}

function runtimeLabel(t: (key: string) => string, status: HiddenNetworkRelayStatus): string {
  switch (status.runtime) {
    case 'dev-proxy':
      return t('hiddenNetworkRuntimeDev')
    default:
      return t('hiddenNetworkRuntimeWeb')
  }
}

function EndpointRow({
  label,
  endpoint,
  loading
}: {
  label: string
  endpoint: HiddenNetworkSocksEndpointStatus | undefined
  loading: boolean
}) {
  const { t } = useTranslation()
  const reachable = endpoint?.reachable === true

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-sm">{label}</div>
        <div className="font-mono text-xs text-muted-foreground break-all">
          {endpoint?.socksUrl ?? '—'}
        </div>
        <div className="text-xs text-muted-foreground">
          {endpoint ? endpointSourceLabel(t, endpoint) : t('hiddenNetworkStatusChecking')}
        </div>
      </div>
      <Badge
        variant={reachable ? 'default' : 'secondary'}
        className={cn('self-start sm:self-center shrink-0', loading && 'opacity-70')}
      >
        {loading ? t('hiddenNetworkStatusChecking') : reachable ? t('hiddenNetworkStatusReady') : t('hiddenNetworkStatusNotRunning')}
      </Badge>
    </div>
  )
}

export default function HiddenNetworkRelayStatusSetting() {
  const { t } = useTranslation()
  const { status, loading, refresh } = useHiddenNetworkRelayStatus()

  const proxyReady =
    status?.proxyAvailable === true && (status.tor.reachable || status.i2p.reachable)

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-2">
        <p>{t('hiddenNetworkRelaysIntro')}</p>
        <p>{t('hiddenNetworkRelaysWebLimit')}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {status ? (
            <>
              <span className="font-medium text-foreground">{t('hiddenNetworkRuntimeLabel')}:</span>{' '}
              {runtimeLabel(t, status)}
            </>
          ) : (
            t('hiddenNetworkStatusChecking')
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-2">{t('Refresh')}</span>
        </Button>
      </div>

      <div className="space-y-2">
        <EndpointRow label={t('hiddenNetworkTorLabel')} endpoint={status?.tor} loading={loading} />
        <EndpointRow label={t('hiddenNetworkI2pLabel')} endpoint={status?.i2p} loading={loading} />
      </div>

      {status?.runtime === 'browser-only' && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
          {t('hiddenNetworkBrowserOnlyNotice')}
        </p>
      )}

      {status && status.runtime !== 'browser-only' && !proxyReady && !loading && (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('hiddenNetworkStartRoutersHint')}
        </p>
      )}

      {status && proxyReady && !loading && (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('hiddenNetworkReadyHint')}
        </p>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>{t('hiddenNetworkEnvHint')}</p>
        <p className="font-mono break-all">IMWALD_TOR_SOCKS=socks5://127.0.0.1:9150</p>
        <p className="font-mono break-all">IMWALD_I2P_SOCKS=socks5://127.0.0.1:7657</p>
      </div>
    </div>
  )
}
