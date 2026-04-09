import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
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

export default function ImageWithLightbox({
  image,
  className,
  classNames = {},
  /** When true, load inline image immediately (ignore tap-to-load policy). */
  mustLoad = false
}: {
  image: TImetaInfo
  className?: string
  classNames?: {
    wrapper?: string
  }
  mustLoad?: boolean
}) {
  const id = useMemo(() => `image-with-lightbox-${randomString()}`, [])
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
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

  const handlePhotoClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    setLightboxPortalActive(true)
    setIndex(0)
  }

  const holdUntilClick = !mustLoad && !autoLoadMedia

  const portal =
    lightboxPortalActive && typeof document !== 'undefined'
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
              slides={[lightboxSlideFromImeta(image)]}
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
      : null

  return (
    <div className="w-full max-w-[400px]">
      <Image
        key={0}
        className={className}
        classNames={{
          wrapper: cn('rounded-lg cursor-zoom-in', classNames.wrapper),
          errorPlaceholder: 'aspect-square h-[30vh]'
        }}
        image={image}
        holdUntilClick={holdUntilClick}
        onClick={(e) => handlePhotoClick(e)}
      />
      {portal}
    </div>
  )
}
