import { ExtendedKind } from '@/constants'
import type { Manifest } from '../manifest-types'

export const groupMetadataManifest: Manifest = {
  kinds: [ExtendedKind.GROUP_METADATA],
  title: 'tag:name',
  body: { source: 'content', format: 'tokenized' },
  fields: [{ label: 'About', source: 'tag:about', format: 'text' }]
}

export const citationManifests: Manifest[] = [
  {
    kinds: [ExtendedKind.CITATION_INTERNAL],
    title: 'tag:title',
    body: { source: 'content', format: 'tokenized' }
  },
  {
    kinds: [ExtendedKind.CITATION_EXTERNAL],
    title: 'tag:title',
    fields: [{ label: 'URL', source: 'tag:url', format: 'url' }],
    body: { source: 'content', format: 'tokenized' }
  },
  {
    kinds: [ExtendedKind.CITATION_HARDCOPY],
    title: 'tag:title',
    fields: [
      { label: 'Author', source: 'tag:author', format: 'text' },
      { label: 'Published', source: 'tag:published_on', format: 'text' }
    ],
    body: { source: 'content', format: 'tokenized' }
  },
  {
    kinds: [ExtendedKind.CITATION_PROMPT],
    title: 'tag:title',
    body: { source: 'content', format: 'markdown' }
  }
]

export const learningResourceManifest: Manifest = {
  kinds: [ExtendedKind.LEARNING_RESOURCE],
  title: 'tag:title',
  cover: 'tag:image',
  fields: [{ label: 'Summary', source: 'tag:summary', format: 'text' }],
  body: { source: 'content', format: 'tokenized' }
}
