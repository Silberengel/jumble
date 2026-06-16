import { ExtendedKind } from '@/constants'
import {
  formatAmbLicenseLabel,
  formatAmbContentSize,
  parseAmbLearningResource
} from '@/lib/amb-learning-resource'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

const sampleEvent: Event = {
  content: 'test',
  created_at: 1781604992,
  id: '22cb396a99434a0e183023ac66e364018d360ee43bac6e1774a71b89af0f3665',
  kind: ExtendedKind.LEARNING_RESOURCE,
  pubkey: '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6',
  sig: '2a4cfbb957d1cd2f36564485c78b2bf39b13859db19f16bda4cbe48a220bd618c2e473b71e6d973abc3d3df8bfe31fb8ee7eded1ba91ea9e28f1a864936594a7',
  tags: [
    ['d', 'b8wfn28a'],
    ['type', 'LearningResource'],
    ['name', 'test'],
    ['description', 'test'],
    ['inLanguage', 'de'],
    ['creator:name', 'laoc42'],
    ['creator:type', 'Person'],
    ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
    ['isAccessibleForFree', 'true'],
    ['about:id', 'nostr:39738:d2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612:religion'],
    ['about:prefLabel:de', 'Religion'],
    ['learningResourceType:id', 'https://edufeed.org/ns/ekw#lrt/audio/erklar-audio'],
    ['learningResourceType:prefLabel:de', 'Erklär-Audio'],
    ['encoding:contentUrl', 'https://blossom.edufeed.org/1fb4b9330f131c18a8e6bfc040bae54747b18ca17b62af997f0ec6a80ccf2afb.pdf'],
    ['encoding:sha256', '1fb4b9330f131c18a8e6bfc040bae54747b18ca17b62af997f0ec6a80ccf2afb'],
    ['encoding:contentSize', '4033487'],
    ['l', 'ekw', 'metadata-form'],
    ['l', 'schule', 'https://edufeed.org/ns/bildungsbereich#'],
    ['ext:ekw:bibleReference', 'Mk'],
    ['client', 'Edufeed']
  ]
}

describe('parseAmbLearningResource', () => {
  it('parses Edufeed kind 30142 sample event', () => {
    const parsed = parseAmbLearningResource(sampleEvent, 'de')
    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe('test')
    expect(parsed?.description).toBe('test')
    expect(parsed?.language).toBe('de')
    expect(parsed?.learningResourceTypeLabel).toBe('Erklär-Audio')
    expect(parsed?.aboutLabel).toBe('Religion')
    expect(parsed?.creatorName).toBe('laoc42')
    expect(parsed?.licenseLabel).toBe('CC BY 4.0')
    expect(parsed?.isAccessibleForFree).toBe(true)
    expect(parsed?.contentFileLabel).toBe('PDF')
    expect(parsed?.contentSizeBytes).toBe(4033487)
    expect(parsed?.taxonomies.map((t) => t.term)).toEqual(['ekw', 'schule'])
    expect(parsed?.extensions).toEqual([{ key: 'ekw:bibleReference', value: 'Mk' }])
    expect(parsed?.client).toBe('Edufeed')
  })

  it('returns null when type LearningResource is missing', () => {
    const event = { ...sampleEvent, tags: sampleEvent.tags.filter((t) => t[0] !== 'type') }
    expect(parseAmbLearningResource(event)).toBeNull()
  })
})

describe('formatAmbLicenseLabel', () => {
  it('formats CC BY 4.0', () => {
    expect(formatAmbLicenseLabel('https://creativecommons.org/licenses/by/4.0/')).toBe('CC BY 4.0')
  })
})

describe('formatAmbContentSize', () => {
  it('formats megabytes', () => {
    expect(formatAmbContentSize(4033487)).toBe('3.8 MB')
  })
})
