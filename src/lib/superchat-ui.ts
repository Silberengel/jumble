/** Shared superchat accent styles — readable in light and dark mode. */

/** “Superchat” label in thread / notification cards. */
export const superchatTitleClass =
  'font-semibold text-amber-700 dark:text-amber-300'

/** Profile wall section heading (“Superchats”). */
export const superchatSectionHeadingClass =
  'text-xs font-semibold uppercase tracking-wider text-amber-800/90 dark:text-amber-200/90'

/** Recipient-confirmed state text. */
export const superchatConfirmedTextClass =
  'text-sm font-medium text-amber-800 dark:text-amber-200'

/** Recipient-confirmed box (prominent notification layout). */
export const superchatConfirmedBoxClass =
  'rounded-md border border-amber-600/35 bg-amber-500/10 px-3 py-2 text-center dark:border-amber-400/40 dark:bg-amber-400/10'

/** Full-width “Turn this into a superchat!” CTA. */
export const superchatProminentButtonClass =
  'h-auto min-h-11 w-full gap-2 border-amber-600/45 bg-amber-500/15 py-2.5 text-base font-semibold text-amber-950 shadow-[0_0_16px_rgba(245,158,11,0.2)] hover:bg-amber-500/25 dark:border-yellow-400/50 dark:bg-yellow-400/20 dark:text-yellow-50 dark:shadow-[0_0_16px_rgba(250,204,21,0.25)] dark:hover:bg-yellow-400/30'

/** Large zap amount / BTC equivalent highlight in ZapDialog. */
export const superchatAmountHighlightClass =
  'rounded-md bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-950 ring-1 ring-amber-600/45 shadow-[0_0_12px_rgba(245,158,11,0.25)] dark:bg-yellow-400/25 dark:text-yellow-100 dark:ring-yellow-400/70 dark:shadow-[0_0_12px_rgba(250,204,21,0.45)]'

/** Leading digit group highlight on large sats input. */
export const superchatSatsLeadingHighlightClass = 'text-amber-600 dark:text-yellow-400'

/** Lightning bolt accent (zap address rows, payto icons). */
export const superchatLightningAccentClass = 'text-amber-600 dark:text-yellow-400'

/**
 * Superchat / zap comment body (thread + profile wall).
 * MarkdownArticle uses `div[role="paragraph"]`, not `<p>`; sizes must not inherit parent `text-sm`.
 */
export const superchatCommentBodyClass =
  'border-l-[3px] border-amber-700 pl-3.5 dark:border-amber-300 ' +
  'max-w-none text-[1.3125rem] font-medium leading-snug text-foreground ' +
  '[&_[role=paragraph]]:text-[1.3125rem] [&_[role=paragraph]]:font-medium [&_[role=paragraph]]:leading-snug ' +
  '[&_p]:text-[1.3125rem] [&_p]:font-medium [&_p]:leading-snug ' +
  'prose-p:text-[1.3125rem] prose-p:font-medium prose-p:leading-snug'
