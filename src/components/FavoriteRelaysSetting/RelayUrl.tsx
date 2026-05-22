import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toRelay } from '@/lib/link'
import { isWebsocketUrl, normalizeAnyRelayUrl } from '@/lib/url'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { CircleX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import logger from '@/lib/logger'

export default function RelayUrls({ relaySetId }: { relaySetId: string }) {
  const { t } = useTranslation()
  const { relaySets, updateRelaySet } = useFavoriteRelays()
  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [newRelayUrlError, setNewRelayUrlError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const relaySet = useMemo(
    () => relaySets.find((r) => r.id === relaySetId),
    [relaySets, relaySetId]
  )

  if (!relaySet) return null

  const removeRelayUrl = async (url: string) => {
    try {
      await updateRelaySet({
        ...relaySet,
        relayUrls: relaySet.relayUrls.filter((u) => u !== url)
      })
    } catch (error) {
      logger.error('Failed to remove relay from set', { error, relaySetId, url })
    }
  }

  const saveNewRelayUrl = async () => {
    if (newRelayUrl === '' || isLoading) return
    const normalizedUrl = normalizeAnyRelayUrl(newRelayUrl)
    if (!normalizedUrl) {
      return setNewRelayUrlError(t('Invalid relay URL'))
    }
    if (relaySet.relayUrls.includes(normalizedUrl)) {
      return setNewRelayUrlError(t('Relay already exists'))
    }
    if (!isWebsocketUrl(normalizedUrl)) {
      return setNewRelayUrlError(t('invalid relay URL'))
    }
    
    setIsLoading(true)
    setNewRelayUrlError(null)
    
    try {
      const newRelayUrls = [...relaySet.relayUrls, normalizedUrl]
      await updateRelaySet({ ...relaySet, relayUrls: newRelayUrls })
      setNewRelayUrl('')
    } catch (error) {
      logger.error('Failed to update relay set', { error, relaySetId, url: normalizedUrl })
      setNewRelayUrlError(t('Failed to add relay. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRelayUrlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewRelayUrl(e.target.value)
    setNewRelayUrlError(null)
  }

  const handleRelayUrlInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveNewRelayUrl()
    }
  }

  return (
    <>
      <div className="mt-1">
        {relaySet.relayUrls.map((url, index) => (
          <RelayUrl key={index} url={url} onRemove={() => removeRelayUrl(url)} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          className={newRelayUrlError ? 'border-destructive' : ''}
          placeholder={t('Add a new relay')}
          value={newRelayUrl}
          onKeyDown={handleRelayUrlInputKeyDown}
          onChange={handleRelayUrlInputChange}
          onBlur={saveNewRelayUrl}
        />
        <Button onClick={saveNewRelayUrl} disabled={isLoading || !newRelayUrl.trim()}>
          {isLoading ? t('Adding...') : t('Add')}
        </Button>
      </div>
      {newRelayUrlError && <div className="text-xs text-destructive mt-1">{newRelayUrlError}</div>}
    </>
  )
}

function RelayUrl({ url, onRemove }: { url: string; onRemove: () => void }) {
  const { push } = useSecondaryPage()
  
  return (
    <div className="flex items-center justify-between pl-1 pr-3">
      <div 
        className="flex gap-3 items-center flex-1 w-0 cursor-pointer hover:bg-muted rounded px-2 py-1 -mx-2 -my-1"
        onClick={() => push(toRelay(url))}
      >
        <RelayIcon url={url} className="w-4 h-4" iconSize={10} />
        <div className="text-muted-foreground text-sm truncate">{url}</div>
      </div>
      <div className="shrink-0">
        <CircleX
          size={16}
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive cursor-pointer"
        />
      </div>
    </div>
  )
}
