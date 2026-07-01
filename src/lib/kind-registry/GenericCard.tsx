import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'
import type { Manifest, Field } from './manifest-types'
import { extractElevatedTags, normText, resolveSource, resolveTemplate } from './resolve'
import MarkdownArticle from '@/components/Note/LazyMarkdownArticle'
import { HttpUrlOpenGraphOrLink } from '@/components/Embedded'

function fieldValue(f: Field, ev: Event): string {
  return 'template' in f ? resolveTemplate(f.template, ev) : resolveSource(f.source, ev)
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

type GenericCardProps = {
  event: Event
  manifest?: Manifest
  className?: string
  /** When true, body text is clamped (feed / embed). */
  clampBody?: boolean
  hideMetadata?: boolean
  autoLoadMedia?: boolean
  /** Show the “unsupported event” banner (fallback for unknown kinds). */
  showUnsupportedBanner?: boolean
  omitKindLabel?: boolean
}

/**
 * Read-only manifest engine: tag bindings → card layout.
 * No buttons, forms, or live fetches.
 */
export default function GenericCard({
  event,
  manifest,
  className,
  clampBody = false,
  hideMetadata,
  autoLoadMedia = true,
  showUnsupportedBanner = false
}: GenericCardProps) {
  const elevated = extractElevatedTags(event.tags)
  const contentRaw = event.content?.trim() ?? ''

  const title = manifest?.title ? resolveSource(manifest.title, event).trim() : elevated.title?.trim()
  const cover = manifest?.cover ? resolveSource(manifest.cover, event).trim() : elevated.imageUrls[0]
  const bodyVal = manifest?.body ? resolveSource(manifest.body.source, event) : contentRaw
  const bodyFormat = manifest?.body?.format ?? 'tokenized'

  const bodyNorm = normText(bodyVal)
  const fields = (manifest?.fields ?? [])
    .map((f) => ({ label: f.label, value: fieldValue(f, event), format: f.format }))
    .filter((f) => f.value && normText(f.value) !== bodyNorm)

  const summary = elevated.summary
  const description = elevated.description

  const showMainBody =
    !!bodyVal &&
    !(summary && normText(summary) === bodyNorm) &&
    !(description && normText(description) === bodyNorm) &&
    !(title && normText(title) === bodyNorm)

  const proseClass = cn(
    'text-sm leading-snug whitespace-pre-wrap break-words text-foreground/95',
    clampBody && 'line-clamp-6'
  )

  return (
    <div className={cn('rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm space-y-2', className)}>
      {showUnsupportedBanner ? (
        <p className="text-xs text-muted-foreground leading-snug">Unsupported event preview</p>
      ) : null}

      {title ? <h3 className="text-base font-semibold leading-snug break-words">{title}</h3> : null}

      {fields.length > 0 ? (
        <dl className="space-y-1.5 text-xs">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="font-medium text-muted-foreground">{f.label}</dt>
              <dd className="break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {summary ? <p className={proseClass}>{summary}</p> : null}
      {description ? <p className={cn(proseClass, 'text-muted-foreground')}>{description}</p> : null}

      {cover && isHttpUrl(cover) ? (
        <div className="not-prose max-w-full overflow-hidden rounded-md">
          <HttpUrlOpenGraphOrLink url={cover} containingEvent={event} block className="w-full" />
        </div>
      ) : null}

      {showMainBody ? (
        bodyFormat === 'markdown' || bodyFormat === 'tokenized' ? (
          <MarkdownArticle
            event={{ ...event, content: bodyVal }}
            hideMetadata={hideMetadata ?? false}
            lazyMedia={!autoLoadMedia}
            className={proseClass}
          />
        ) : (
          <p className={proseClass}>{bodyVal}</p>
        )
      ) : null}

      {!showMainBody && !summary && !description && !title && !fields.length && !cover ? (
        <p className="text-xs text-muted-foreground italic">No preview available</p>
      ) : null}
    </div>
  )
}
