import AsciidocArticle from '@/components/Note/AsciidocArticle/AsciidocArticle'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import NoteOptions from '@/components/NoteOptions'
import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import { fetchPublicationTreeForExport } from '@/lib/publication-export'
import {
  buildPublicationSectionTree,
  flattenPublicationSectionTreeForToc,
  type PublicationSectionTreeNode
} from '@/lib/publication-section-tree'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { BookOpen, Loader2 } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ASCIIDOC_CONTENT_KINDS = new Set<number>([
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE
])

type HeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

function SectionHeadingRow({
  title,
  event,
  Heading
}: {
  title: string
  event?: Event
  Heading: HeadingTag
}) {
  return (
    <div className="flex min-w-0 items-start gap-1">
      <Heading className="min-w-0 flex-1 text-base font-semibold break-words text-foreground">
        {title}
      </Heading>
      {event ? <NoteOptions event={event} className="shrink-0 -mr-1 -mt-0.5" /> : null}
    </div>
  )
}

function SectionContent({ event }: { event: Event }) {
  if (ASCIIDOC_CONTENT_KINDS.has(event.kind)) {
    return (
      <AsciidocArticle className="mt-2" event={event} hideImagesAndInfo hideTitle />
    )
  }
  if (event.kind === kinds.LongFormArticle) {
    return <MarkdownArticle className="mt-2" event={event} hideMetadata />
  }
  if ((event.content ?? '').trim()) {
    return (
      <div className="mt-2 whitespace-pre-wrap break-words text-base text-foreground">
        {event.content}
      </div>
    )
  }
  return null
}

function PublicationSectionNodeView({ node }: { node: PublicationSectionTreeNode }) {
  const Heading = `h${Math.min(6, node.depth + 2)}` as HeadingTag

  return (
    <section id={node.sectionId} className="scroll-mt-24 mt-4 first:mt-0">
      <SectionHeadingRow title={node.title} event={node.event} Heading={Heading} />
      {node.isPublicationBranch && node.event?.content.trim() ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
          {node.event.content.trim()}
        </div>
      ) : null}
      {node.isPublicationBranch ? (
        node.children.length > 0 ? (
          <div className="mt-4 border-l border-border pl-4">
            {node.children.map((child) => (
              <PublicationSectionNodeView key={child.path} node={child} />
            ))}
          </div>
        ) : null
      ) : node.event ? (
        <SectionContent event={node.event} />
      ) : null}
    </section>
  )
}

function PublicationTableOfContents({
  entries,
  className
}: {
  entries: ReturnType<typeof flattenPublicationSectionTreeForToc>
  className?: string
}) {
  const { t } = useTranslation()

  const scrollToSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (entries.length === 0) return null

  return (
    <nav
      className={cn('rounded-lg border border-border bg-muted/20 p-3', className)}
      aria-label={t('Publication table of contents')}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {t('Publication table of contents')}
      </div>
      <ol className="max-h-64 space-y-0.5 overflow-y-auto text-sm">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="w-full min-w-0 rounded py-1 pr-2 text-left text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
              onClick={() => scrollToSection(entry.id)}
            >
              <span className="break-words">{entry.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export default function PublicationIndexBody({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { favoriteRelays } = useFavoriteRelays()
  const relayUrls = useMemo(
    () =>
      Array.from(
        new Set([
          ...currentBrowsingRelayUrls.map((url) => normalizeAnyRelayUrl(url) || url),
          ...favoriteRelays.map((url) => normalizeAnyRelayUrl(url) || url),
          ...FAST_READ_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url)
        ])
      ).filter(Boolean) as string[],
    [currentBrowsingRelayUrls, favoriteRelays]
  )

  const [fetched, setFetched] = useState<Map<string, Event> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFetched(null)

    fetchPublicationTreeForExport(event, relayUrls)
      .then((tree) => {
        if (cancelled) return
        setFetched(tree)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [event, relayUrls])

  const sectionTree = useMemo(
    () => (fetched ? buildPublicationSectionTree(event, fetched) : []),
    [event, fetched]
  )

  const tocEntries = useMemo(
    () => flattenPublicationSectionTreeForToc(sectionTree),
    [sectionTree]
  )

  const hasRefs = orderedPublicationRefsFromIndex(event).length > 0
  if (!hasRefs) return null

  return (
    <div className={cn('min-w-0 space-y-4', className)}>
      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          {t('Publication contents loading')}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">
          {t('Publication contents load failed')}: {error}
        </p>
      ) : null}

      {fetched && !error ? (
        <>
          <PublicationTableOfContents entries={tocEntries} />
          <div>
            {sectionTree.map((node) => (
              <PublicationSectionNodeView key={node.path} node={node} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
