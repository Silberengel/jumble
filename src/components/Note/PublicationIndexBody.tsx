import AsciidocArticle from '@/components/Note/AsciidocArticle/AsciidocArticle'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import NoteOptions from '@/components/NoteOptions'
import { DOCUMENT_RELAY_URLS, ExtendedKind, FAST_READ_RELAY_URLS, LIBRARY_RELAY_URLS } from '@/constants'
import { useProgressivePublicationContent } from '@/hooks/useProgressivePublicationContent'
import { orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import { publicationRefKey } from '@/lib/publication-section-fetch'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function SectionLoadingPlaceholder() {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
    </div>
  )
}

function SectionMissingPlaceholder() {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-sm italic text-muted-foreground/80">
      {t('Publication section missing')}
    </p>
  )
}

function PublicationSectionNodeView({
  node,
  failedKeys,
  loadingKeys,
  onRequestLoad,
  onReadAhead
}: {
  node: PublicationSectionTreeNode
  failedKeys: ReadonlySet<string>
  loadingKeys: ReadonlySet<string>
  onRequestLoad: (ref: PublicationSectionTreeNode['ref'], indexEvent: Event) => void
  onReadAhead: () => void
}) {
  const Heading = `h${Math.min(6, node.depth + 2)}` as HeadingTag
  const sectionElRef = useRef<HTMLElement>(null)
  const refKey = publicationRefKey(node.ref)
  const isMissing = Boolean(refKey && failedKeys.has(refKey))
  const isLoading = Boolean(refKey && loadingKeys.has(refKey))
  const needsLoad = Boolean(refKey && !node.event && !isMissing && !isLoading)

  useEffect(() => {
    if (!needsLoad) return
    const el = sectionElRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          onRequestLoad(node.ref, node.indexEvent)
          onReadAhead()
        }
      },
      { rootMargin: '720px 0px 480px 0px', threshold: 0 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [needsLoad, node.ref, node.indexEvent, onRequestLoad, onReadAhead])

  return (
    <section
      ref={sectionElRef}
      id={node.sectionId}
      className="scroll-mt-24 mt-4 first:mt-0"
      aria-busy={isLoading || needsLoad}
    >
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
              <PublicationSectionNodeView
                key={child.path}
                node={child}
                failedKeys={failedKeys}
                loadingKeys={loadingKeys}
                onRequestLoad={onRequestLoad}
                onReadAhead={onReadAhead}
              />
            ))}
          </div>
        ) : needsLoad || isLoading ? (
          <SectionLoadingPlaceholder />
        ) : isMissing ? (
          <SectionMissingPlaceholder />
        ) : null
      ) : isMissing ? (
        <SectionMissingPlaceholder />
      ) : isLoading || needsLoad ? (
        <SectionLoadingPlaceholder />
      ) : node.event ? (
        <SectionContent event={node.event} />
      ) : (
        <SectionMissingPlaceholder />
      )}
    </section>
  )
}

function PublicationTableOfContents({
  entries,
  readingStarted,
  onStartReading,
  className
}: {
  entries: ReturnType<typeof flattenPublicationSectionTreeForToc>
  readingStarted: boolean
  onStartReading: () => void
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
              className={cn(
                'w-full min-w-0 rounded py-1 pr-2 text-left text-muted-foreground',
                readingStarted && 'hover:bg-accent hover:text-accent-foreground'
              )}
              style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
              disabled={!readingStarted}
              onClick={() => scrollToSection(entry.id)}
            >
              <span className="break-words">{entry.title}</span>
            </button>
          </li>
        ))}
      </ol>
      {!readingStarted ? (
        <button
          type="button"
          className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={onStartReading}
        >
          {t('Read this book')}
        </button>
      ) : null}
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
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { favoriteRelays } = useFavoriteRelays()
  const relayUrls = useMemo(
    () =>
      Array.from(
        new Set([
          ...LIBRARY_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url),
          ...DOCUMENT_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url),
          ...currentBrowsingRelayUrls.map((url) => normalizeAnyRelayUrl(url) || url),
          ...favoriteRelays.map((url) => normalizeAnyRelayUrl(url) || url),
          ...FAST_READ_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url)
        ])
      ).filter(Boolean) as string[],
    [currentBrowsingRelayUrls, favoriteRelays]
  )

  const [readingStarted, setReadingStarted] = useState(false)

  useEffect(() => {
    setReadingStarted(false)
  }, [event.id])

  const { fetched, failedKeys, loadingKeys, requestLoad, readAhead } =
    useProgressivePublicationContent(event, relayUrls, { enabled: readingStarted })

  const sectionTree = useMemo(
    () => buildPublicationSectionTree(event, fetched),
    [event, fetched]
  )

  const tocEntries = useMemo(
    () => flattenPublicationSectionTreeForToc(sectionTree),
    [sectionTree]
  )

  const startReading = useCallback(() => {
    setReadingStarted(true)
  }, [])

  useEffect(() => {
    if (!readingStarted) return
    const firstId = tocEntries[0]?.id
    if (!firstId) return
    requestAnimationFrame(() => {
      document.getElementById(firstId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [readingStarted, tocEntries])

  const hasRefs = orderedPublicationRefsFromIndex(event).length > 0
  if (!hasRefs) return null

  return (
    <div className={cn('min-w-0 space-y-4', className)}>
      <PublicationTableOfContents
        entries={tocEntries}
        readingStarted={readingStarted}
        onStartReading={startReading}
      />
      {readingStarted ? (
        <div>
          {sectionTree.map((node) => (
            <PublicationSectionNodeView
              key={node.path}
              node={node}
              failedKeys={failedKeys}
              loadingKeys={loadingKeys}
              onRequestLoad={requestLoad}
              onReadAhead={readAhead}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
