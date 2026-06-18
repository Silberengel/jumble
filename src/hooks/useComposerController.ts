import {
  computeComposerBlockReason,
  formatComposerBlockMessage,
  type ComposerBlockReason,
  type ComposerBlockReasonInput
} from '@/lib/composer-block-reason'
import type { TFunction } from 'i18next'
import { useMemo } from 'react'

export type { ComposerBlockReason, ComposerBlockReasonInput }

export function useComposerBlockReason(input: ComposerBlockReasonInput): ComposerBlockReason {
  return useMemo(() => computeComposerBlockReason(input), [input])
}

export function useCanPostFromBlockReason(blockReason: ComposerBlockReason): boolean {
  return blockReason === null
}

export type UseComposerControllerResult = {
  blockReason: ComposerBlockReason
  canPost: boolean
  blockMessage: string | null
}

/**
 * Shared publish gating for dialog and full-screen composer page.
 * Centralizes {@link computeComposerBlockReason} and user-visible block messages.
 */
export function useComposerController(
  input: ComposerBlockReasonInput,
  relayCapBlockInfo: ComposerBlockReasonInput['relayCapBlockInfo'],
  t: TFunction
): UseComposerControllerResult {
  const blockReason = useComposerBlockReason(input)
  const canPost = blockReason === null
  const blockMessage = useMemo(
    () => formatComposerBlockMessage(blockReason, relayCapBlockInfo, t),
    [blockReason, relayCapBlockInfo, t]
  )
  return { blockReason, canPost, blockMessage }
}
