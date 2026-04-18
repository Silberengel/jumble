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

  it('uses English Piper for Japanese and Korean (no native ja/ko voices)', () => {
    const ja = getPiperVoiceForChosenLanguage('ja')
    expect(ja.voice).toBe(TRINITY_PIPER_VOICE.en)
    expect(ja.usedEnglishVoiceFallback).toBe(true)
    expect(ja.usedRelatedVoiceFallback).toBe(false)
    expect(ja.piperProfileCode).toBe('en')

    const ko = getPiperVoiceForChosenLanguage('ko')
    expect(ko.voice).toBe(TRINITY_PIPER_VOICE.en)
    expect(ko.usedEnglishVoiceFallback).toBe(true)
    expect(ko.piperProfileCode).toBe('en')
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

  it('uses British Piper for en-gb before base en would pick US', () => {
    const r = getPiperVoiceForChosenLanguage('en-gb')
    expect(r.voice).toBe(EXTRA_READ_ALOUD_PIPER_VOICE['en-gb'])
    expect(r.piperProfileCode).toBe('en-gb')
    expect(r.usedEnglishVoiceFallback).toBe(false)
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
