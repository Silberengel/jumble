import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { useTranslation } from 'react-i18next'
import RelayItem from './RelayItem'

export default function FavoriteRelayList() {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { favoriteRelays, blockedRelays, reorderFavoriteRelays, favoriteRelaysFromPublishedList } =
    useFavoriteRelays()
  
  // Show all relays including blocked ones (they'll be marked visually)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = favoriteRelays.findIndex((relay) => relay === active.id)
      const newIndex = favoriteRelays.findIndex((relay) => relay === over.id)

      const reorderedRelays = arrayMove(favoriteRelays, oldIndex, newIndex)
      reorderFavoriteRelays(reorderedRelays)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground font-semibold select-none">{t('Relays')}</div>
      {!!pubkey && !favoriteRelaysFromPublishedList && (
        <p
          className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          role="status"
        >
          {t('favoriteRelaysDefaultsBanner', {
            defaultValue:
              'No favorite-relays list (kind 10012) is loaded for this account yet. The relays below are app defaults and local relay sets, not a published list from your relays.'
          })}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={favoriteRelays} strategy={verticalListSortingStrategy}>
          <div className="grid gap-2">
            {favoriteRelays.map((relay) => (
              <RelayItem key={relay} relay={relay} isBlocked={blockedRelays.includes(relay)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
