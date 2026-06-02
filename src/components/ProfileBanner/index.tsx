import { generateImageByPubkey } from '@/lib/pubkey'
import { isVideo } from '@/lib/url'
import { useEffect, useMemo, useState } from 'react'
import Image from '../Image'
import { cn } from '@/lib/utils'

/** Layout hint for {@link Image} wrapper — banners are always cropped to 3:1 regardless of source pixels. */
const BANNER_DIM = { width: 3, height: 1 } as const

const bannerShellClass =
  'relative w-full overflow-hidden aspect-[3/1] max-h-36 sm:max-h-44 md:max-h-52'

export default function ProfileBanner({
  pubkey,
  banner,
  className,
  imageFetchPriority
}: {
  pubkey: string
  banner?: string
  className?: string
  /** Prefer loading the profile picture first on profile pages (`low` defers the banner). */
  imageFetchPriority?: 'high' | 'low' | 'auto'
}) {
  const defaultBanner = useMemo(() => generateImageByPubkey(pubkey), [pubkey])
  const [bannerUrl, setBannerUrl] = useState(banner ?? defaultBanner)

  useEffect(() => {
    if (banner) {
      setBannerUrl(banner)
    } else {
      setBannerUrl(defaultBanner)
    }
  }, [defaultBanner, banner])

  if (isVideo(bannerUrl)) {
    return (
      <div className={cn(bannerShellClass, className)}>
        <video
          src={bannerUrl}
          className="absolute inset-0 h-full w-full object-cover object-center"
          autoPlay
          muted
          loop
          playsInline
          fetchPriority={imageFetchPriority}
          aria-label={`${pubkey} banner`}
          onError={() => setBannerUrl(defaultBanner)}
        />
      </div>
    )
  }

  return (
    <div className={cn(bannerShellClass, className)}>
      <Image
        image={{ url: bannerUrl, pubkey, dim: BANNER_DIM }}
        alt={`${pubkey} banner`}
        className="h-full w-full object-cover rounded-none"
        classNames={{ wrapper: 'block h-full w-full' }}
        fetchPriority={imageFetchPriority}
        onError={() => setBannerUrl(defaultBanner)}
      />
    </div>
  )
}
