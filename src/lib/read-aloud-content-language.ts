/**
 * Heuristic language guess for read-aloud / Piper when there is no persisted translation `lang`.
 * Keep in sync with `services/piper-tts-proxy/server.ts` `detectLanguage` (same script / ratio logic),
 * plus `en-gb` hints and a few extra Latin scripts (pl, cs, tr) that have Piper voices in-app.
 */
export function detectReadAloudContentLanguage(text: string): string {
  if (!text || text.length === 0) return 'en'

  const sample = text.slice(0, Math.min(500, text.length))
  const total = sample.length || 1

  const germanChars = (sample.match(/[äöüßÄÖÜ]/g) || []).length
  const frenchChars = (sample.match(/[éèêëàâäçôùûüÉÈÊËÀÂÄÇÔÙÛÜ]/g) || []).length
  const spanishChars = (sample.match(/[ñáéíóúüÑÁÉÍÓÚÜ¿¡]/g) || []).length
  const italianChars = (sample.match(/[àèéìòùÀÈÉÌÒÙ]/g) || []).length
  const cyrillicChars = (sample.match(/[а-яёА-ЯЁ]/g) || []).length
  const hangulChars = (sample.match(/[\uac00-\ud7af]/g) || []).length
  const kanaChars = (sample.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length
  const hanChars = (sample.match(/[\u4e00-\u9fff]/g) || []).length
  const arabicChars = (sample.match(/[\u0600-\u06ff]/g) || []).length
  const polishChars = (sample.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) || []).length
  const czechChars = (sample.match(/[řůŘŮ]/g) || []).length
  /** Exclude üöç (shared with German / French); rely on ğ/ı/ş/İ so “Grüße” is not Turkish. */
  const turkishChars = (sample.match(/[ğĞıİşŞ]/g) || []).length

  const cyrillicRatio = cyrillicChars / total
  const hangulRatio = hangulChars / total
  const kanaRatio = kanaChars / total
  const hanRatio = hanChars / total
  const arabicRatio = arabicChars / total
  const germanRatio = germanChars / total
  const frenchRatio = frenchChars / total
  const spanishRatio = spanishChars / total
  const italianRatio = italianChars / total
  const polishRatio = polishChars / total
  const czechRatio = czechChars / total
  const turkishRatio = turkishChars / total

  if (cyrillicRatio > 0.1) return 'ru'
  if (hangulRatio > 0.06 || kanaRatio > 0.02) return 'en'
  if (hanRatio > 0.1) return 'zh'
  if (arabicRatio > 0.1) return 'ar'
  if (germanRatio > 0.02) return 'de'
  if (frenchRatio > 0.02) return 'fr'
  /** Before Spanish: shared letters like `ó` (Polish) would otherwise count as Spanish. */
  if (polishRatio > 0.02) return 'pl'
  if (czechRatio > 0.015) return 'cs'
  if (spanishRatio > 0.02) return 'es'
  if (italianRatio > 0.02) return 'it'
  if (turkishRatio > 0.02) return 'tr'

  if (preferBritishEnglish(sample)) {
    return 'en-gb'
  }
  return 'en'
}

/** Weak signal: UK spellings vs US spellings when the rest looks like Latin “English”. */
function preferBritishEnglish(sample: string): boolean {
  const uk =
    /\b(colour|behaviour|realise|realising|centre|defence|favour|favourite|organised|travelling|neighbour|humour|labour)\b/gi
  const us =
    /\b(color|behavior|realize|realizing|center|defense|favor|favorite|organized|traveling|neighbor|humor|labor)\b/gi
  let ukN = 0
  let usN = 0
  for (const _ of sample.matchAll(uk)) ukN++
  for (const _ of sample.matchAll(us)) usN++
  return ukN > usN
}
