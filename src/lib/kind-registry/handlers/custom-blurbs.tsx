import { ExtendedKind } from '@/constants'
import { isNip18RepostKind, isNip25ReactionKind } from '@/lib/event'
import {
  getParentReplyBlurbDisplayText,
  getParentReplyBlurbFallbackLabel,
  parentReplyPollQuestionBlurb
} from '@/lib/parent-reply-blurb'
import type { RenderCtx } from '../types'

export function renderTextBlurb(ctx: RenderCtx) {
  return (
    getParentReplyBlurbDisplayText(ctx.displayEvent) ||
    getParentReplyBlurbFallbackLabel(ctx.displayEvent)
  )
}

export function renderRepostBlurb(_ctx: RenderCtx) {
  return null
}

export function renderPollBlurb(ctx: RenderCtx) {
  return parentReplyPollQuestionBlurb(ctx.displayEvent.content ?? '') || null
}

export const renderNotificationBlurbs = {
  pollResponse(_ctx: RenderCtx) {
    return null
  }
}

export function renderReactionBlurb(_ctx: RenderCtx) {
  return null
}

export function resolveBlurbLine(
  ctx: RenderCtx,
  t: (key: string, opts?: Record<string, unknown>) => string,
  reactionSummaryKey?: string
): string {
  const kind = ctx.event.kind
  if (isNip25ReactionKind(kind)) {
    return reactionSummaryKey ? t(reactionSummaryKey) : t('Reaction')
  }
  if (isNip18RepostKind(kind)) {
    return t('Notification boost summary')
  }
  if (kind === ExtendedKind.POLL_RESPONSE) {
    return t('Notification poll vote summary')
  }
  if (kind === ExtendedKind.POLL) {
    return parentReplyPollQuestionBlurb(ctx.displayEvent.content ?? '') || t('Poll')
  }
  return (
    getParentReplyBlurbDisplayText(ctx.displayEvent) ||
    getParentReplyBlurbFallbackLabel(ctx.displayEvent)
  )
}
