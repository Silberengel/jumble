import type { PaymentMethodGroup } from '@/lib/merge-payment-methods'
import { getCanonicalPaytoType, getPaytoTypeInfo, type PaytoCategory } from '@/lib/payto-registry'

export const PAYTO_CATEGORIES: readonly PaytoCategory[] = [
  'bitcoin',
  'bitcoin-layer',
  'monero',
  'crypto',
  'stablecoin',
  'fiat',
  'tip'
] as const

export function isPaytoCategory(value: string): value is PaytoCategory {
  return (PAYTO_CATEGORIES as readonly string[]).includes(value)
}

/** i18n key under `paytoCategory.*` */
export function paytoCategoryTranslationKey(category: PaytoCategory): string {
  return `paytoCategory.${category}`
}

export function getPaymentMethodGroupCategory(group: PaymentMethodGroup): PaytoCategory | null {
  const type = group.methods.find((m) => m.type)?.type
  if (!type) return null
  if (getCanonicalPaytoType(type) === 'monero') return 'monero'
  return getPaytoTypeInfo(type)?.category ?? null
}

/** Monero stays in the crypto bucket in the catalog but has its own preference category on Nostr. */
export function groupMatchesPreferredPaytoCategory(
  group: PaymentMethodGroup,
  preferred: PaytoCategory
): boolean {
  const category = getPaymentMethodGroupCategory(group)
  if (!category) return false
  if (category === preferred) return true
  if (preferred === 'crypto' && category === 'monero') return true
  return false
}

export function partitionPaymentGroupsByPreferredCategory(
  groups: PaymentMethodGroup[],
  preferred: PaytoCategory | null
): { preferredGroups: PaymentMethodGroup[]; otherGroups: PaymentMethodGroup[] } {
  if (!preferred) {
    return { preferredGroups: groups, otherGroups: [] }
  }
  const preferredGroups: PaymentMethodGroup[] = []
  const otherGroups: PaymentMethodGroup[] = []
  for (const group of groups) {
    if (groupMatchesPreferredPaytoCategory(group, preferred)) {
      preferredGroups.push(group)
    } else {
      otherGroups.push(group)
    }
  }
  // No matches on this profile: show everything expanded instead of an empty list + accordion.
  if (preferredGroups.length === 0) {
    return { preferredGroups: groups, otherGroups: [] }
  }
  return { preferredGroups, otherGroups }
}
