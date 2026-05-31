/**
 * Shared toolbar icon buttons for mention (npub) search and event/address (nevent/naddr) search.
 * Must be rendered inside NeventPickerProvider.
 */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import UserItem, { UserItemSkeleton } from '@/components/UserItem'
import { useSearchProfiles } from '@/hooks'
import { MENTION_NPUB_DROPDOWN_LIMIT } from '@/services/mention-event-search.service'
import { AtSign, FileSearch } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNeventPicker } from './useNeventPicker'

type ButtonVariant = 'ghost' | 'outline'

export function MentionAndEventToolbarButtons({
  insertAtCursor,
  buttonClassName,
  variant = 'outline'
}: {
  insertAtCursor: (text: string) => void
  /** Optional class for the icon buttons (e.g. for consistency with surrounding toolbar). */
  buttonClassName?: string
  /** Button variant to match surrounding toolbar (e.g. 'ghost' for PostEditor). */
  variant?: ButtonVariant
}) {
  const { t } = useTranslation()
  const neventPicker = useNeventPicker()
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const { profiles, isFetching: mentionLoading, debouncedSearch: debouncedMentionQuery } =
    useSearchProfiles(mentionOpen ? mentionQuery : '', MENTION_NPUB_DROPDOWN_LIMIT)

  const closeMention = useCallback(() => {
    setMentionOpen(false)
    setMentionQuery('')
  }, [])

  const selectNpub = useCallback(
    (npub: string) => {
      insertAtCursor(`nostr:${npub} `)
      closeMention()
    },
    [insertAtCursor, closeMention]
  )

  const defaultButtonClass = 'h-8 w-8'
  const btnClass = buttonClassName ?? defaultButtonClass

  return (
    <>
      <Popover open={mentionOpen} onOpenChange={(open) => (open ? setMentionOpen(true) : closeMention())}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size="icon"
            title={t('Insert mention')}
            className={btnClass}
          >
            <AtSign className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(20rem,calc(100vw-1.5rem))] max-w-none p-2 z-[10000]"
          align="start"
          side="bottom"
          sideOffset={4}
        >
          <Input
            placeholder={t('Search for user…')}
            value={mentionQuery}
            onChange={(e) => setMentionQuery(e.target.value)}
            className="mb-2"
            autoFocus
          />
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {mentionLoading && profiles.length === 0 && (
              <div className="px-1 py-2 space-y-1">
                <UserItemSkeleton hideFollowButton />
                <UserItemSkeleton hideFollowButton />
              </div>
            )}
            {!mentionLoading && debouncedMentionQuery && profiles.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">{t('No users found')}</div>
            )}
            {profiles.map((profile) => (
              <Button
                key={profile.pubkey}
                type="button"
                variant="ghost"
                className="w-full justify-start text-left h-auto py-1 px-1 font-normal"
                onClick={() => selectNpub(profile.npub)}
              >
                <UserItem
                  pubkey={profile.pubkey}
                  hideFollowButton
                  hideNip05
                  prefetchedProfile={profile}
                  deferRemoteAvatar={false}
                  className="pointer-events-none w-full"
                />
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant={variant}
        size="icon"
        title={t('Insert event or address')}
        className={btnClass}
        onClick={() => neventPicker?.openNeventPicker((link) => insertAtCursor(link + ' '))}
      >
        <FileSearch className="h-4 w-4" />
      </Button>
    </>
  )
}
