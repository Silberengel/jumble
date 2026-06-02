import { toRelay } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import SaveRelayDropdownMenu from '../SaveRelayDropdownMenu'

export default function RelayItem({ relay, isBlocked = false }: { relay: string; isBlocked?: boolean }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: relay
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      className={`relative group clickable flex min-w-0 gap-1 rounded-lg border p-2 select-none sm:gap-2 ${isBlocked ? 'opacity-60' : ''}`}
      ref={setNodeRef}
      style={style}
      onClick={() => push(toRelay(relay))}
    >
      <div
        className="shrink-0 cursor-grab touch-none rounded p-2 hover:bg-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <RelayIcon url={relay} skipRelayInfoFetch={isBlocked} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="break-all text-sm font-semibold leading-snug">{relay}</div>
            {isBlocked ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">({t('blocked')})</span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
          <SaveRelayDropdownMenu urls={[relay]} />
        </div>
      </div>
    </div>
  )
}
