/** Coerce relay / JSON event kinds (sometimes strings) to a finite integer. */
export function normalizeEventKind(kind: unknown): number {
  const k = typeof kind === 'number' ? kind : Number(kind)
  return Number.isFinite(k) ? Math.trunc(k) : NaN
}
