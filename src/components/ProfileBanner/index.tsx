import { generateImageByPubkey } from '@/lib/pubkey'
import { isVideo } from '@/lib/url'
import { useEffect, useMemo, useState } from 'react'
import Image from '../Image'
import { cn } from '@/lib/utils'

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
      <div className={cn('overflow-hidden rounded-none', className)}>
        <video
          src={bannerUrl}
          className="h-full w-full object-cover object-center"
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
    <Image
      image={{ url: bannerUrl, pubkey }}
      alt={`${pubkey} banner`}
      className={cn('rounded-none', className)}
      fetchPriority={imageFetchPriority}
      onError={() => setBannerUrl(defaultBanner)}
    />
  )
}
