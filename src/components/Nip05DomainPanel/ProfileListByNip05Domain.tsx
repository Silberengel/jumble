import UserItem from '@/components/UserItem'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchNip05NamePubkeysFromDomain } from '@/lib/nip05'
import { useEffect, useMemo, useRef, useState } from 'react'
import Nip05DomainEmptyState from './Nip05DomainEmptyState'

export type TNip05NamePubkey = { name: string; pubkey: string }

export default function ProfileListByNip05Domain({ domain }: { domain: string }) {
  const [entries, setEntries] = useState<TNip05NamePubkey[] | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const bottomRef = useRef<HTMLDivElement>(null)
  const entriesKey = useMemo(
    () => (entries ? entries.map((e) => `${e.name}:${e.pubkey}`).join('\u0001') : ''),
    [entries]
  )

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setVisibleCount(10)
    void fetchNip05NamePubkeysFromDomain(domain).then((rows) => {
      if (!cancelled) setEntries(rows)
    })
    return () => {
      cancelled = true
    }
  }, [domain])

  useEffect(() => {
    if (!entries?.length) return
    setVisibleCount(10)
  }, [entriesKey, entries])

  useEffect(() => {
    if (!entries?.length) return
    const options = { root: null, rootMargin: '10px', threshold: 1 }
    const observer = new IntersectionObserver((obs) => {
      if (obs[0]?.isIntersecting && visibleCount < entries.length) {
        setVisibleCount((n) => Math.min(n + 10, entries.length))
      }
    }, options)
    const node = bottomRef.current
    if (node) observer.observe(node)
    return () => {
      if (node) observer.unobserve(node)
    }
  }, [visibleCount, entriesKey, entries])

  if (entries === null) {
    return (
      <div className="space-y-2 px-4 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return <Nip05DomainEmptyState domain={domain} />
  }

  const visible = entries.slice(0, visibleCount)
  return (
    <div className="px-4 pt-2">
      {visible.map(({ name, pubkey }) => (
        <div
          key={`${pubkey}:${name}`}
          className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1 last:border-0"
        >
          {name && name !== '_' ? (
            <span className="shrink-0 text-sm text-muted-foreground">{name}</span>
          ) : null}
          <div className="min-w-0 flex-1">
            <UserItem pubkey={pubkey} hideNip05 />
          </div>
        </div>
      ))}
      {visibleCount < entries.length ? <div ref={bottomRef} className="h-4" /> : null}
    </div>
  )
}
