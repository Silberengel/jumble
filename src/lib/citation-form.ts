import {
  createCitationExternalDraftEvent,
  createCitationHardcopyDraftEvent,
  createCitationInternalDraftEvent,
  createCitationPromptDraftEvent
} from '@/lib/draft-event'
import type { TDraftEvent } from '@/types'

export type CitationFormType = 'internal' | 'external' | 'hardcopy' | 'prompt'

export type CitationFormValues = {
  internalCTag: string
  internalRelayHint: string
  externalUrl: string
  externalOpenTimestamp: string
  hardcopyPageRange: string
  hardcopyChapterTitle: string
  hardcopyEditor: string
  hardcopyPublishedIn: string
  hardcopyVolume: string
  hardcopyDoi: string
  promptLlm: string
  title: string
  author: string
  publishedOn: string
  publishedBy: string
  accessedOn: string
  location: string
  geohash: string
  version: string
  summary: string
}

export function emptyCitationFormValues(): CitationFormValues {
  return {
    internalCTag: '',
    internalRelayHint: '',
    externalUrl: '',
    externalOpenTimestamp: '',
    hardcopyPageRange: '',
    hardcopyChapterTitle: '',
    hardcopyEditor: '',
    hardcopyPublishedIn: '',
    hardcopyVolume: '',
    hardcopyDoi: '',
    promptLlm: '',
    title: '',
    author: '',
    publishedOn: '',
    publishedBy: '',
    accessedOn: '',
    location: '',
    geohash: '',
    version: '',
    summary: ''
  }
}

export function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0]!
}

export function formatCitationDateToISO(dateStr: string): string {
  if (!dateStr?.trim()) return ''
  if (dateStr.includes('T')) return dateStr
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T00:00:00Z`).toISOString()
  }
  return dateStr
}

export function isCitationFormValid(type: CitationFormType, values: CitationFormValues): boolean {
  switch (type) {
    case 'internal':
      return !!values.internalCTag.trim()
    case 'external':
      return !!values.externalUrl.trim() && !!values.accessedOn.trim()
    case 'hardcopy':
      return !!values.accessedOn.trim()
    case 'prompt':
      return !!values.promptLlm.trim() && !!values.accessedOn.trim()
    default:
      return false
  }
}

export function buildCitationDraftEvent(
  type: CitationFormType,
  content: string,
  values: CitationFormValues
): TDraftEvent {
  switch (type) {
    case 'internal':
      return createCitationInternalDraftEvent(content, {
        cTag: values.internalCTag.trim(),
        relayHint: values.internalRelayHint.trim() || undefined,
        title: values.title.trim() || undefined,
        author: values.author.trim() || undefined,
        publishedOn: values.publishedOn.trim() || undefined,
        accessedOn: values.accessedOn.trim() || undefined,
        location: values.location.trim() || undefined,
        geohash: values.geohash.trim() || undefined,
        summary: values.summary.trim() || undefined
      })
    case 'external':
      return createCitationExternalDraftEvent(content, {
        url: values.externalUrl.trim(),
        accessedOn: values.accessedOn.trim() || new Date().toISOString(),
        title: values.title.trim() || undefined,
        author: values.author.trim() || undefined,
        publishedOn: values.publishedOn.trim() || undefined,
        publishedBy: values.publishedBy.trim() || undefined,
        version: values.version.trim() || undefined,
        location: values.location.trim() || undefined,
        geohash: values.geohash.trim() || undefined,
        openTimestamp: values.externalOpenTimestamp.trim() || undefined,
        summary: values.summary.trim() || undefined
      })
    case 'hardcopy':
      return createCitationHardcopyDraftEvent(content, {
        accessedOn:
          formatCitationDateToISO(values.accessedOn.trim()) || new Date().toISOString(),
        title: values.title.trim() || undefined,
        author: values.author.trim() || undefined,
        pageRange: values.hardcopyPageRange.trim() || undefined,
        chapterTitle: values.hardcopyChapterTitle.trim() || undefined,
        editor: values.hardcopyEditor.trim() || undefined,
        publishedOn: values.publishedOn.trim()
          ? formatCitationDateToISO(values.publishedOn.trim())
          : undefined,
        publishedBy: values.publishedBy.trim() || undefined,
        publishedIn: values.hardcopyPublishedIn.trim() || undefined,
        volume: values.hardcopyVolume.trim() || undefined,
        doi: values.hardcopyDoi.trim() || undefined,
        version: values.version.trim() || undefined,
        location: values.location.trim() || undefined,
        geohash: values.geohash.trim() || undefined,
        summary: values.summary.trim() || undefined
      })
    case 'prompt':
      return createCitationPromptDraftEvent(content, {
        llm: values.promptLlm.trim(),
        accessedOn: values.accessedOn.trim() || new Date().toISOString(),
        version: values.version.trim() || undefined,
        summary: values.summary.trim() || undefined,
        url: values.externalUrl.trim() || undefined
      })
  }
}
