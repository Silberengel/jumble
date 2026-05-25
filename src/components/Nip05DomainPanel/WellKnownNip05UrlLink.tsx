import { getWellKnownNip05Url } from '@/lib/nip05'
import { cn } from '@/lib/utils'

export default function WellKnownNip05UrlLink({
  domain,
  className
}: {
  domain: string
  className?: string
}) {
  const url = getWellKnownNip05Url(domain)
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'text-primary hover:underline underline-offset-2 break-all',
        className
      )}
    >
      {url}
    </a>
  )
}
