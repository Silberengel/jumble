import { describe, expect, it } from 'vitest'
import {
  EXTRA_READ_ALOUD_PIPER_VOICE,
  getPiperVoiceForChosenLanguage,
  TRINITY_PIPER_VOICE
} from '@/lib/trinity-languages'

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

  it('uses native Portuguese Piper for pt', () => {
    const r = getPiperVoiceForChosenLanguage('pt')
    expect(r.voice).toBe(EXTRA_READ_ALOUD_PIPER_VOICE.pt)
    expect(r.usedEnglishVoiceFallback).toBe(false)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('pt')
  })

  it('uses native Italian Piper for it', () => {
    const r = getPiperVoiceForChosenLanguage('it')
    expect(r.voice).toBe(EXTRA_READ_ALOUD_PIPER_VOICE.it)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('it')
  })

  it('routes Dutch-adjacent tags to German when not trinity native', () => {
    const r = getPiperVoiceForChosenLanguage('gsw')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.de)
    expect(r.usedRelatedVoiceFallback).toBe(true)
  })

  it('uses native Arabic Piper when base is Arabic', () => {
    const r = getPiperVoiceForChosenLanguage('ar')
    expect(r.voice).toBe(EXTRA_READ_ALOUD_PIPER_VOICE.ar)
    expect(r.usedEnglishVoiceFallback).toBe(false)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('ar')
  })

  it('uses Arabic Piper for regional Arabic tags', () => {
    const r = getPiperVoiceForChosenLanguage('ar-SA')
    expect(r.voice).toBe(EXTRA_READ_ALOUD_PIPER_VOICE.ar)
    expect(r.piperProfileCode).toBe('ar')
  })

  it('falls back to English Piper for unmapped languages', () => {
    const r = getPiperVoiceForChosenLanguage('hi')
    expect(r.voice).toBe(TRINITY_PIPER_VOICE.en)
    expect(r.usedEnglishVoiceFallback).toBe(true)
    expect(r.usedRelatedVoiceFallback).toBe(false)
    expect(r.piperProfileCode).toBe('en')
  })
})
