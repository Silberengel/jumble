import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { METADATA_RELAYS_ONLY_POLICY_CHANGED_EVENT, setRestrictConnectionsToMetadataRelaysOnly } from '@/lib/read-only-relay-personal'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function MetadataRelaysOnlySetting() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const on = storage.getRestrictRelaysToMetadataLists()
    setEnabled(on)
    setRestrictConnectionsToMetadataRelaysOnly(on)
  }, [])

  const onChange = (checked: boolean) => {
    setEnabled(checked)
    storage.setRestrictRelaysToMetadataLists(checked)
    setRestrictConnectionsToMetadataRelaysOnly(checked)
    client.interruptBackgroundQueries({ closePooledRelayConnections: true })
    client.closeMetadataPolicyDisallowedRelayConnections()
    window.dispatchEvent(new CustomEvent(METADATA_RELAYS_ONLY_POLICY_CHANGED_EVENT))
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex items-center space-x-2">
        <Label htmlFor="metadata-relays-only">{t('Only my relay lists')}</Label>
        <Switch id="metadata-relays-only" checked={enabled} onCheckedChange={onChange} />
      </div>
      <div className="text-muted-foreground text-xs max-w-xl">
        {t(
          'When on (default), the app only opens read connections to relays on your Read & Write, Favorite, Cache, and HTTP relay lists, plus hard-coded relays only while a query or subscription needs them. Publishing is unchanged. Relay explore and Search pages are exempt.'
        )}
      </div>
    </div>
  )
}
