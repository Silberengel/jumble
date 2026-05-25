import { Skeleton } from '@/components/ui/skeleton'
import { splitNip05Identifier, verifyNip05 } from '@/lib/nip05'
import { toProfileList } from '@/lib/link'
import { SecondaryPageLink } from '@/PageManager'
import { BadgeAlert, BadgeCheck } from 'lucide-react'
import { Favicon } from '../Favicon'
import { useEffect, useState } from 'react'

interface Nip05Verification {
  nip05: string
  isVerified: boolean
  nip05Name: string
  nip05Domain: string
  isFetching: boolean
}

export default function Nip05List({ nip05List, pubkey }: { nip05List: string[]; pubkey: string }) {
  const [verifications, setVerifications] = useState<Map<string, Nip05Verification>>(new Map())

  useEffect(() => {
    if (!nip05List || nip05List.length === 0 || !pubkey) return

    const verifyAll = async () => {
      const newVerifications = new Map<string, Nip05Verification>()
      
      // Initialize all as fetching
      nip05List.forEach((nip05) => {
        const parts = splitNip05Identifier(nip05.trim())
        newVerifications.set(nip05, {
          nip05,
          isVerified: false,
          nip05Name: parts?.name ?? '',
          nip05Domain: parts?.domain ?? '',
          isFetching: true
        })
      })
      setVerifications(newVerifications)

      // Verify each NIP-05 address
      await Promise.all(
        nip05List.map(async (nip05) => {
          try {
            const result = await verifyNip05(nip05, pubkey)
            setVerifications(prev => {
              const updated = new Map(prev)
              const fb = splitNip05Identifier(nip05.trim())
              updated.set(nip05, {
                nip05,
                isVerified: result.isVerified,
                nip05Name: result.nip05Name || fb?.name || '',
                nip05Domain: result.nip05Domain || fb?.domain || '',
                isFetching: false
              })
              return updated
            })
          } catch (error) {
            setVerifications(prev => {
              const updated = new Map(prev)
              const fb = splitNip05Identifier(nip05.trim())
              const existing = updated.get(nip05) || {
                nip05,
                isVerified: false,
                nip05Name: fb?.name || '',
                nip05Domain: fb?.domain || '',
                isFetching: false
              }
              updated.set(nip05, { ...existing, isFetching: false })
              return updated
            })
          }
        })
      )
    }

    verifyAll()
  }, [nip05List, pubkey])

  if (nip05List.length === 0) return null

  return (
    <div className="text-sm text-muted-foreground flex flex-col gap-1 mt-1">
      {nip05List.map((nip05, idx) => {
        const verification = verifications.get(nip05)
        const isFetching = verification?.isFetching ?? true
        const isVerified = verification?.isVerified ?? false
        const fb = splitNip05Identifier(nip05.trim())
        const nip05Name = verification?.nip05Name || fb?.name || ''
        const nip05Domain = verification?.nip05Domain || fb?.domain || ''

        if (isFetching) {
          return (
            <div key={idx} className="flex items-center gap-1">
              <Skeleton className="h-3 w-32" />
            </div>
          )
        }

        return (
          <div
            key={idx}
            className="flex items-center gap-1 truncate [&_svg]:!size-3.5 [&_svg]:shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {nip05Name !== '_' ? (
              <span className="text-sm text-muted-foreground truncate shrink-0">{nip05Name}@</span>
            ) : null}
            {isVerified ? (
              <Favicon
                domain={nip05Domain}
                className="w-3.5 h-3.5 rounded-full"
                fallback={<BadgeCheck className="text-primary" />}
              />
            ) : (
              <BadgeAlert className="text-muted-foreground" />
            )}
            <SecondaryPageLink
              to={toProfileList({ domain: nip05Domain })}
              className={`truncate text-sm hover:text-foreground hover:underline underline-offset-2 transition-colors ${isVerified ? 'text-primary' : 'text-muted-foreground'}`}
            >
              {nip05Domain}
            </SecondaryPageLink>
          </div>
        )
      })}
    </div>
  )
}

