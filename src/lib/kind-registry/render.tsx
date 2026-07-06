import type { ReactNode } from 'react'
import UnknownNote from '@/components/Note/UnknownNote'
import GenericCard from './GenericCard'
import { normalizeEventKind } from './normalize-kind'
import { handlerFor, registeredHandlerFor } from './registry'
import type { RenderCtx, Surface } from './types'

function clampForSurface(surface: Surface): boolean {
  return surface === 'timeline' || surface === 'embed' || surface === 'preview'
}

function dispatchBody(ctx: RenderCtx, mode: 'body' | 'preview'): ReactNode {
  const kind = normalizeEventKind(ctx.event.kind)
  const handler = handlerFor(kind)
  if (!handler) {
    return (
      <UnknownNote
        className={ctx.className}
        event={ctx.displayEvent}
        omitKindLabel
      />
    )
  }

  if (handler.hideBody && mode === 'body') {
    return null
  }

  if (mode === 'preview') {
    const preview = handler.renderPreview?.(ctx)
    if (preview !== undefined && preview !== null) return preview
  }

  const rendered = handler.render?.(ctx)
  if (rendered !== undefined && rendered !== null) return rendered

  if (handler.manifest) {
    return (
      <GenericCard
        event={ctx.displayEvent}
        manifest={handler.manifest}
        className={ctx.className}
        clampBody={clampForSurface(ctx.surface)}
        hideMetadata={ctx.hideMetadata}
        autoLoadMedia={ctx.autoLoadMedia}
        showUnsupportedBanner={!registeredHandlerFor(kind)}
      />
    )
  }

  if (!registeredHandlerFor(kind)) {
    return (
      <UnknownNote
        className={ctx.className}
        event={ctx.displayEvent}
        omitKindLabel
        showAuthorSummary={ctx.surface === 'embed'}
      />
    )
  }

  return null
}

/** Render the kind-specific event body (timeline / focused / embed / reader). */
export function KindEventBody(ctx: RenderCtx) {
  return dispatchBody(ctx, 'body')
}

/** Render preview surface (ContentPreview). */
export function KindEventPreview(ctx: RenderCtx) {
  return dispatchBody(ctx, 'preview')
}

export function kindHandlerHideBody(kind: number): boolean {
  return handlerFor(kind)?.hideBody === true
}

export function isKindRenderable(kind: number): boolean {
  const k = normalizeEventKind(kind)
  if (!Number.isFinite(k)) return false
  const registered = registeredHandlerFor(k)
  if (registered) return registered.renderable !== false
  return false
}
