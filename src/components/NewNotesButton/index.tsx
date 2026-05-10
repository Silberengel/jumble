import { Button } from '@/components/ui/button'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ArrowUp } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function NewNotesButton({
  newEvents = [],
  onClick
}: {
  newEvents?: Event[]
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const pubkeys = useMemo(() => {
    const arr: string[] = []
    for (const event of newEvents) {
      if (!arr.includes(event.pubkey)) {
        arr.push(event.pubkey)
      }
      if (arr.length >= 3) break
    }
    return arr
  }, [newEvents])

  return (
    <>
      {newEvents.length > 0 && (
        <div
          className={cn(
            'w-full flex justify-center z-[100] pointer-events-none',
            isSmallScreen ? 'fixed' : 'absolute bottom-6'
          )}
          style={isSmallScreen ? { bottom: 'calc(4rem + env(safe-area-inset-bottom))' } : undefined}
        >
          <Button
            onClick={onClick}
            className="group rounded-full h-fit py-2 pl-2 pr-3 hover:bg-primary-hover pointer-events-auto"
          >
            {pubkeys.length > 0 && (
              <div className="*:data-[slot=avatar]:ring-background flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:grayscale">
                {pubkeys.map((pubkey) => (
                  <SimpleUserAvatar key={pubkey} userId={pubkey} size="small" />
                ))}
              </div>
            )}
            <div className="text-md font-medium">
              {t('Show n new notes', { n: newEvents.length > 99 ? '99+' : newEvents.length })}
            </div>
            <ArrowUp />
          </Button>
        </div>
      )}
    </>
  )
}
