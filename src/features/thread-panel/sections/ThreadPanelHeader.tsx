import { Separator } from '@/components/ui/separator'
import { ExtendedKind } from '@/constants'
import { useTranslation } from 'react-i18next'
import ReplySort, { type ReplySortOption } from '@/components/NoteInteractions/ReplySort'

export default function ThreadPanelHeader({
  replySort,
  onSortChange,
  isDiscussion
}: {
  replySort: ReplySortOption
  onSortChange: (sort: ReplySortOption) => void
  isDiscussion: boolean
}) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex items-center gap-2 min-w-0 px-2 sm:px-4 md:px-6 py-2">
        <h2 className="min-w-0 flex-1 font-semibold text-xs sm:text-sm md:text-base text-foreground">
          {t('Replies')}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {isDiscussion && (
            <ReplySort selectedSort={replySort} onSortChange={onSortChange} />
          )}
        </div>
      </div>
      <Separator />
    </>
  )
}

export function threadPanelShowQuotes(
  eventKind: number,
  showQuotesProp?: boolean
): boolean {
  const isDiscussion = eventKind === ExtendedKind.DISCUSSION
  return showQuotesProp ?? !isDiscussion
}
