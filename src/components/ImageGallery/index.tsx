import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { ReactNode, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { lightboxSlideFromImeta } from '@/lib/lightbox-slides'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/captions.css'
import Image from '../Image'
import ImageWithLightbox from '../ImageWithLightbox'

const galleryImageWrapper = (className?: string) =>
  cn('w-full max-w-full min-w-0', className)

export default function ImageGallery({
  className,
  images,
  start = 0,
  end = images.length,
  mustLoad = false,
  authorPubkey
}: {
  className?: string
  images: TImetaInfo[]
  start?: number
  end?: number
  mustLoad?: boolean
  authorPubkey?: string | null
}) {
  const id = useMemo(() => `image-gallery-${randomString()}`, [])
  const autoLoadMedia = useShouldAutoLoadMedia(authorPubkey ?? images[start]?.pubkey)
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

  const handlePhotoClick = (event: React.MouseEvent, current: number) => {
    event.stopPropagation()
    event.preventDefault()
    const newIndex = start + current
    logger.debug('[ImageGallery] Click:', {
      start,
      current,
      newIndex,
      totalImages: images.length,
      displayImages: displayImages.length
    })
    setLightboxPortalActive(true)
    setIndex(newIndex)
  }

  const displayImages = images.slice(start, end)
  /** Tap-to-load: no shared grid lightbox — each image uses {@link ImageWithLightbox}. */
  const tapToLoadGallery = !mustLoad && !autoLoadMedia

  useLayoutEffect(() => {
    if (tapToLoadGallery) {
      setIndex(-1)
      setLightboxPortalActive(false)
    }
  }, [tapToLoadGallery])

  if (displayImages.length === 1) {
    return (
      <ImageWithLightbox
        image={displayImages[0]}
        mustLoad={mustLoad}
        className="max-h-[80vh] sm:max-h-[50vh] object-contain"
        classNames={{
          wrapper: galleryImageWrapper(className)
        }}
      />
    )
  }

  let imageContent: ReactNode | null = null
  if (tapToLoadGallery) {
    imageContent = (
      <>
        {displayImages.map((image, i) => (
          <ImageWithLightbox
            key={i}
            image={image}
            className="max-h-[80vh] sm:max-h-[50vh] object-contain"
            classNames={{
              wrapper: galleryImageWrapper(className)
            }}
          />
        ))}
      </>
    )
  } else if (displayImages.length === 2 || displayImages.length === 4) {
    imageContent = (
      <div className="grid grid-cols-2 gap-2 w-full max-w-[400px]">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            className="aspect-square w-full cursor-zoom-in"
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  } else {
    imageContent = (
      <div className="grid grid-cols-3 gap-2 w-full max-w-[400px]">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            className="aspect-square w-full cursor-zoom-in"
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  }

  const portal =
    !tapToLoadGallery && lightboxPortalActive && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-lightbox-overlay
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <Lightbox
              index={index}
              slides={(() => {
                const slides = images.map((img) => lightboxSlideFromImeta(img))
                logger.debug('[ImageGallery] Lightbox slides:', {
                  index,
                  slidesCount: slides.length,
                  slides
                })
                return slides
              })()}
              plugins={[Video, Zoom, Captions]}
              open={index >= 0}
              close={() => setIndex(-1)}
              on={{
                exited: () => setLightboxPortalActive(false)
              }}
              controller={{
                closeOnBackdropClick: false,
                closeOnPullUp: true,
                closeOnPullDown: true
              }}
              render={{
                buttonPrev: images.length <= 1 ? () => null : undefined,
                buttonNext: images.length <= 1 ? () => null : undefined
              }}
              styles={{
                toolbar: { paddingTop: '2.25rem' }
              }}
              carousel={{
                finite: false
              }}
            />
          </div>,
          document.body
        )
      : null

  return (
    <div className={cn('w-full', className)}>
      {imageContent}
      {portal}
    </div>
  )
}
