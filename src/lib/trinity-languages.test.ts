import { describe, expect, it } from 'vitest'
import { getPiperVoiceForChosenLanguage, TRINITY_PIPER_VOICE } from '@/lib/trinity-languages'

describe('getPiperVoiceForChosenLanguage', () => {
  it('uses native Piper for trinity codes', () => {
    const r = getPiperVoiceForChosenLanguage('de')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.de)
    expect(r.usedEnglishVoiceFallback).toBe(false)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('de')
  })

  it('routes Japanese and Korean to Chinese Piper', () => {
    const ja = getPiperVoiceForChosenLanguage('ja')
    expect(ja.voice).toBe(TRINITY_PIPER_VOICE.zh)
    expect(ja.usedRelatedVoiceFallback).toBe(true)
    expect(ja.piperProfileCode).toBe('zh')

    const ko = getPiperVoiceForChosenLanguage('ko')
    expect(ko.piperProfileCode).toBe('zh')
  })

  it('routes Ukrainian to Russian Piper', () => {
    const r = getPiperVoiceForChosenLanguage('uk')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.ru)
    expect(r.usedRelatedVoiceFallback).toBe(true)
    expect(r.piperProfileCode).toBe('ru')
  })

  it('routes Portuguese to Spanish Piper', () => {
    const r = getPiperVoiceForChosenLanguage('pt')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.es)
    expect(r.usedRelatedVoiceFallback).toBe(true)
  })

  it('routes Dutch-adjacent tags to German when not trinity native', () => {
    const r = getPiperVoiceForChosenLanguage('gsw')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.de)
    expect(r.usedRelatedVoiceFallback).toBe(true)
  })

  it('falls back to English Piper for unmapped languages', () => {
    const r = getPiperVoiceForChosenLanguage('ar')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.en)
    expect(r.usedEnglishVoiceFallback).toBe(true)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('en')
  })
})
