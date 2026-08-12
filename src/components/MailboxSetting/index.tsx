import { Button } from '@/components/ui/button'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import { isLocalNetworkUrl, normalizeAnyRelayUrl } from '@/lib/url'
import { relayListHasUsableMailboxUrls } from '@/lib/viewer-relay-defaults'
import indexedDb from '@/services/indexed-db.service'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay, TMailboxRelayScope } from '@/types'
import { kinds } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import MailboxRelay from './MailboxRelay'
import NewMailboxRelayInput from './NewMailboxRelayInput'
import RelayCountWarning from './RelayCountWarning'
import SaveButton from './SaveButton'
import DiscoveredRelays from './DiscoveredRelays'

export default function MailboxSetting() {
  const { t } = useTranslation()
  const { pubkey, relayList, checkLogin } = useNostr()
  const [relays, setRelays] = useState<TMailboxRelay[]>([])
  const [hasChange, setHasChange] = useState(false)
  const [showingKind10002Fallback, setShowingKind10002Fallback] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = relays.findIndex((relay) => relay.url === active.id)
      const newIndex = relays.findIndex((relay) => relay.url === over?.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        setRelays((relays) => arrayMove(relays, oldIndex, newIndex))
        setHasChange(true)
      }
    }
  }

  useEffect(() => {
    if (!relayList) return

    // Filter out cache relays (local network URLs) - they belong in kind 10432, not kind 10002
    const mailboxRelays = relayList.originalRelays.filter((relay) => !isLocalNetworkUrl(relay.url))
    setRelays(mailboxRelays)
  }, [relayList])

  useEffect(() => {
    let cancelled = false
    const pk = pubkey?.trim()
    if (!pk) {
      setShowingKind10002Fallback(false)
      return
    }
    void indexedDb
      .getReplaceableEvent(pk, kinds.RelayList)
      .then((ev) => {
        if (cancelled) return
        if (!ev) {
          setShowingKind10002Fallback(true)
          return
        }
        setShowingKind10002Fallback(!relayListHasUsableMailboxUrls(getRelayListFromEvent(ev)))
      })
      .catch(() => {
        if (!cancelled) setShowingKind10002Fallback(true)
      })
    return () => {
      cancelled = true
    }
  }, [pubkey, relayList])

  // Synthetic FAST_* mailbox: enable Save so the user can publish it as a real kind 10002.
  useEffect(() => {
    if (showingKind10002Fallback && relays.length > 0) {
      setHasChange(true)
    }
  }, [showingKind10002Fallback, relays])

  if (!pubkey) {
    return (
      <div className="flex flex-col w-full items-center">
        <Button size="lg" onClick={() => checkLogin()}>
          {t('Login to set')}
        </Button>
      </div>
    )
  }

  if (!relayList) {
    return <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
  }

  const changeMailboxRelayScope = (url: string, scope: TMailboxRelayScope) => {
    setRelays((prev) => prev.map((r) => (r.url === url ? { ...r, scope } : r)))
    setHasChange(true)
  }

  const removeMailboxRelay = (url: string) => {
    setRelays((prev) => prev.filter((r) => r.url !== url))
    setHasChange(true)
  }

  const saveNewMailboxRelay = (url: string) => {
    if (url === '') return null
    const normalizedUrl = normalizeAnyRelayUrl(url)
    if (!normalizedUrl) {
      return t('Invalid relay URL')
    }
    if (relays.some((r) => r.url === normalizedUrl)) {
      return t('Relay already exists')
    }
    setRelays([...relays, { url: normalizedUrl, scope: 'both' }])
    setHasChange(true)
    return null
  }

  const handleAddDiscoveredRelays = (newRelays: TMailboxRelay[]) => {
    const relaysToAdd = newRelays.filter((newRelay) => !relays.some((r) => r.url === newRelay.url))
    if (relaysToAdd.length > 0) {
      setRelays([...relays, ...relaysToAdd])
      setHasChange(true)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{t('read relays description')}</div>
        <div>{t('write relays description')}</div>
        <div>{t('read & write relays notice')}</div>
      </div>
      {showingKind10002Fallback && (
        <p
          className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          role="status"
        >
          {t('mailboxKind10002Fallback', {
            defaultValue:
              'No usable NIP-65 relay list (kind 10002) yet — showing default FAST_READ / FAST_WRITE relays. Edit and save to publish your own list. Profile-index mirrors alone are not treated as a mailbox.'
          })}
        </p>
      )}
      <DiscoveredRelays onAdd={handleAddDiscoveredRelays} />
      <RelayCountWarning relays={relays} />
      <SaveButton mailboxRelays={relays} hasChange={hasChange} setHasChange={setHasChange} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={relays.map((r) => r.url)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {relays.map((relay) => (
              <MailboxRelay
                key={relay.url}
                mailboxRelay={relay}
                changeMailboxRelayScope={changeMailboxRelayScope}
                removeMailboxRelay={removeMailboxRelay}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <NewMailboxRelayInput saveNewMailboxRelay={saveNewMailboxRelay} />
    </div>
  )
}
