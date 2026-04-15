/**
 * Optional plain text used for the next read-aloud instead of deriving text from the event
 * (e.g. after translating in the advanced lab). One-shot per event id.
 */
const overrides = new Map<string, string>()

export function setReadAloudTranslationForEvent(eventId: string, plainText: string): void {
  overrides.set(eventId, plainText)
}

export function takeReadAloudTranslationForEvent(eventId: string): string | undefined {
  const v = overrides.get(eventId)
  if (v !== undefined) {
    overrides.delete(eventId)
    return v
  }
  return undefined
}
