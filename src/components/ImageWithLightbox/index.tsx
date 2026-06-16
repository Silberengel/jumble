import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { lightboxSlideFromImeta } from '@/lib/lightbox-slides'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/captions.css'
import Image from '../Image'

function LightboxPortal({
  active,
  image,
  index,
  onClose,
  onExited
}: {
  active: boolean
  image: TImetaInfo
  index: number
  onClose: () => void
  onExited: () => void
}) {
  if (!active || typeof document === 'undefined') return null
  return createPortal(
    <div
      data-lightbox-overlay
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <Lightbox
        index={index}
        slides={[lightboxSlideFromImeta(image)]}
        plugins={[Video, Zoom, Captions]}
        open={index >= 0}
        close={onClose}
        on={{
          exited: onExited
        }}
        controller={{
          closeOnBackdropClick: false,
          closeOnPullUp: true,
          closeOnPullDown: true
        }}
        render={{
          buttonPrev: () => null,
          buttonNext: () => null
        }}
        styles={{
          toolbar: { paddingTop: '2.25rem' }
        }}
      />
    </div>,
    document.body
  )
}

export default function ImageWithLightbox({
  image,
  className,
  classNames = {},
  /** When true, load inline image immediately (ignore tap-to-load policy). */
  mustLoad = false,
  rootClassName,
  /** Full-bleed square cover (album art) — avoids feed Image placeholder min-heights. */
  variant = 'default'
}: {
  image: TImetaInfo
  className?: string
  classNames?: {
    wrapper?: string
  }
  mustLoad?: boolean
  /** Outer wrapper — default feed width; pass `w-full` for card embeds. */
  rootClassName?: string
  variant?: 'default' | 'cover'
}) {
  const id = useMemo(() => `image-with-lightbox-${randomString()}`, [])
  const autoLoadMedia = useShouldAutoLoadMedia(image.pubkey)
  const [index, setIndex] = useState(-1)
  const [lightboxPortalActive, setLightboxPortalActive] = useState(false)

  useEffect(() => {
    if (index >= 0) {
      modalManager.register(id, () => {
        setIndex(-1)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [id, index])

  const openLightbox = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    setLightboxPortalActive(true)
    setIndex(0)
  }

  const holdUntilClick = !mustLoad && !autoLoadMedia

  const portal = (
    <LightboxPortal
      active={lightboxPortalActive}
      image={image}
      index={index}
      onClose={() => setIndex(-1)}
      onExited={() => setLightboxPortalActive(false)}
    />
  )

  if (variant === 'cover') {
    const alt = image.alt?.trim() || ''
    return (
      <>
        <button
          type="button"
          className={cn(
            'not-prose group relative block w-full overflow-hidden p-0 leading-none cursor-zoom-in',
            'aspect-square w-full bg-muted/30',
            rootClassName,
            className
          )}
          onClick={openLightbox}
          aria-label={alt || undefined}
        >
          <img
            src={image.url}
            alt={alt}
            className="absolute inset-0 m-0 size-full max-w-none object-cover object-center"
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer-when-downgrade"
            draggable={false}
          />
        </button>
        {portal}
      </>
    )
  }

  return (
    <div className={cn(!rootClassName && 'w-full max-w-[400px]', rootClassName)}>
      <Image
        key={0}
        className={className}
        classNames={{
          wrapper: cn('rounded-lg cursor-zoom-in', classNames.wrapper),
          errorPlaceholder: 'aspect-square h-[30vh]'
        }}
        image={image}
        holdUntilClick={holdUntilClick}
        onClick={openLightbox}
      />
      {portal}
    </div>
  )
}
