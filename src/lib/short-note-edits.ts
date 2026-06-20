import { ExtendedKind } from '@/constants'
import { tagNameEquals } from '@/lib/tag'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

export type ShortNoteEditState = {
  /** Most recent author-signed edit (NIP-41), if any. */
  latestAuthorEdit?: Event
  /** All author edits, oldest first. */
  authorEdits: Event[]
}

/** `e` tag on kind 1010 pointing at the edited kind-1 note id. */
export function getShortNoteEditTargetId(edit: Event): string | undefined {
  if (edit.kind !== ExtendedKind.SHORT_NOTE_EDIT) return undefined
  const tag = edit.tags.find(tagNameEquals('e')) ?? edit.tags.find(tagNameEquals('E'))
  const id = tag?.[1]
  if (!id || !/^[0-9a-f]{64}$/i.test(id)) return undefined
  return id.toLowerCase()
}

/** Whether `edit` is a valid author revision of `kind1` (same pubkey as the note). */
export function isAuthorShortNoteEdit(edit: Event, kind1: Pick<Event, 'id' | 'pubkey'>): boolean {
  if (edit.kind !== ExtendedKind.SHORT_NOTE_EDIT) return false
  const target = getShortNoteEditTargetId(edit)
  if (!target || target !== kind1.id.toLowerCase()) return false
  return edit.pubkey.toLowerCase() === kind1.pubkey.toLowerCase()
}

export function pickLatestAuthorShortNoteEdit(
  edits: readonly Event[],
  kind1: Pick<Event, 'id' | 'pubkey'>
): Event | undefined {
  let latest: Event | undefined
  for (const edit of edits) {
    if (!isAuthorShortNoteEdit(edit, kind1)) continue
    if (!latest || edit.created_at > latest.created_at) latest = edit
  }
  return latest
}

export function buildShortNoteEditState(
  edits: readonly Event[],
  kind1: Pick<Event, 'id' | 'pubkey'>
): ShortNoteEditState {
  const authorEdits = edits
    .filter((e) => isAuthorShortNoteEdit(e, kind1))
    .sort((a, b) => a.created_at - b.created_at)
  return {
    latestAuthorEdit: authorEdits.length ? authorEdits[authorEdits.length - 1] : undefined,
    authorEdits
  }
}

/** Dedupe by edit id and rebuild author edit state for a kind-1 note. */
export function mergeShortNoteEditEvents(
  existing: readonly Event[],
  incoming: readonly Event[],
  kind1: Pick<Event, 'id' | 'pubkey'>
): ShortNoteEditState {
  const byId = new Map<string, Event>()
  for (const edit of [...existing, ...incoming]) {
    byId.set(edit.id.toLowerCase(), edit)
  }
  return buildShortNoteEditState([...byId.values()], kind1)
}

/** Apply the latest author edit content to a kind-1 note for display. */
export function mergeEditedShortNote(kind1: Event, edit?: Event | null): Event {
  if (!edit || edit.content === kind1.content) return kind1
  return { ...kind1, content: edit.content }
}

/**
 * Kind-1 parent text for a reply-to blurb: original note unless the reply tags a kind-1010
 * revision (`e` + `edit` marker). Does not apply the latest edit when no revision is tagged.
 */
export function resolveShortNoteParentForReplyBlurb(
  parent: Event,
  reply: Event,
  pinnedEdit?: Event | null
): Event {
  if (parent.kind !== kinds.ShortTextNote) return parent

  let edit = pinnedEdit ?? undefined
  if (!edit) {
    const editId = getReplyShortNoteEditId(reply)
    if (editId) {
      edit = client.peekSessionCachedEvent(editId)
    }
  }
  if (edit && isAuthorShortNoteEdit(edit, parent)) {
    return mergeEditedShortNote(parent, edit)
  }
  return parent
}

/** Kind-1111 reply: `e` tag with marker `edit` referencing a kind-1010 revision. */
export function getReplyShortNoteEditId(reply: Event): string | undefined {
  const tag = reply.tags.find(
    ([name, id, , marker]) =>
      (name === 'e' || name === 'E') &&
      marker === 'edit' &&
      typeof id === 'string' &&
      /^[0-9a-f]{64}$/i.test(id)
  )
  return tag?.[1]?.toLowerCase()
}

/**
 * Resolve the kind-1 thread root for a reply parent (kind 1 or kind 1111 on kind 1).
 * Uses session cache only — never blocks on relay REQ.
 */
export function peekKind1ThreadRootFromParent(parentEvent: Event): Event | undefined {
  if (parentEvent.kind === kinds.ShortTextNote) return parentEvent

  if (parentEvent.kind === ExtendedKind.COMMENT || parentEvent.kind === ExtendedKind.VOICE_COMMENT) {
    const rootKindRaw =
      parentEvent.tags.find(tagNameEquals('K'))?.[1] ?? parentEvent.tags.find(tagNameEquals('k'))?.[1]
    const rootKind = rootKindRaw != null ? Number(rootKindRaw) : undefined
    if (rootKind != null && rootKind !== kinds.ShortTextNote) return undefined

    const rootId =
      parentEvent.tags.find(tagNameEquals('E'))?.[1] ??
      parentEvent.tags.find(tagNameEquals('e'))?.[1]
    if (!rootId || !/^[0-9a-f]{64}$/i.test(rootId)) return undefined
    const root = client.peekSessionCachedEvent(rootId.toLowerCase())
    if (root?.kind === kinds.ShortTextNote) return root
    return undefined
  }

  return undefined
}
