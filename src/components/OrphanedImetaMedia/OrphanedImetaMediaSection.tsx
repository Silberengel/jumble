import Image from '@/components/Image'
import MediaPlayer from '@/components/MediaPlayer'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { categorizeImetaMedia } from '@/lib/imeta-content-match'
import { cn } from '@/lib/utils'
import type { TImetaInfo } from '@/types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function OrphanedImetaMediaSection({
  items,
  authorPubkey,
  mustLoadMedia,
  deferLongVideoLoad = false,
  className,
  onImageClick
}: {
  items: TImetaInfo[]
  authorPubkey?: string
  mustLoadMedia?: boolean
  deferLongVideoLoad?: boolean
  className?: string
  onImageClick?: (url: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('not-prose', className)}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-between gap-2 font-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <span>{t('View additional media')}</span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
          {t('Orphaned imeta media notice')}
        </p>
        {items.map((info) => {
          const category = categorizeImetaMedia(info)
          if (category === 'image') {
            return (
              <div key={`orphan-imeta-${info.url}`} className="max-w-[400px]">
                <Image
                  image={{
                    url: info.url,
                    pubkey: info.pubkey ?? authorPubkey,
                    blurHash: info.blurHash,
                    alt: info.alt,
                    dim: info.dim,
                    thumb: info.thumb,
                    image: info.image
                  }}
                  className="w-full rounded-lg cursor-zoom-in"
                  classNames={{
                    wrapper: 'rounded-lg w-full',
                    errorPlaceholder: 'aspect-square h-[30vh]'
                  }}
                  holdUntilClick={!mustLoadMedia}
                  onClick={
                    onImageClick
                      ? (e) => {
                          e.stopPropagation()
                          onImageClick(info.url)
                        }
                      : undefined
                  }
                />
              </div>
            )
          }
          if (category === 'video' || category === 'audio') {
            return (
              <div key={`orphan-imeta-${info.url}`} className="w-full max-w-full overflow-hidden">
                <MediaPlayer
                  src={info.url}
                  className="w-full max-w-full sm:max-w-[400px]"
                  mustLoad={mustLoadMedia}
                  authorPubkey={authorPubkey}
                  deferLoadUntilClick={deferLongVideoLoad}
                  poster={info.image || info.thumb}
                  blurHash={info.blurHash}
                  dim={info.dim}
                />
              </div>
            )
          }
          return null
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}
