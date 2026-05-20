/** Hover: forest primary + underline (rest state stays lighter green, no underline). */
const URI_LINK_HOVER =
  'hover:text-primary hover:underline underline-offset-2 transition-colors'

/** http(s), payto://, and inline URIs in notes, bios, and previews. */
export const URI_LINK_CLASS =
  `text-link-uri no-underline ${URI_LINK_HOVER} break-words`

/** Primary-tinted URIs (profile websites, payment rows using theme primary). */
export const PRIMARY_LINK_HOVER_CLASS =
  `text-link-uri no-underline ${URI_LINK_HOVER} break-words`

/** For HTML template literals (asciidoc pipeline, etc.). */
export const URI_LINK_INLINE_HTML_CLASS = `inline ${URI_LINK_CLASS}`
