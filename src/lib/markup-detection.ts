/**
 * Markup detection and processing utilities
 */

export type MarkupType = 'asciidoc' | 'advanced-markdown' | 'basic-markdown' | 'plain-text'

/**
 * Detect the type of markup used in content
 */
export function detectMarkupType(content: string, eventKind?: number): MarkupType {
  // Publications and wiki articles (30818) use AsciiDoc
  if (eventKind === 30041 || eventKind === 30818) {
    return 'asciidoc'
  }
  
  // Nostr specifications (30817) use markdown
  if (eventKind === 30817) {
    return 'advanced-markdown'
  }
  
  // Long Form Articles (kind 30023) should use markdown detection
  if (eventKind === 30023) {
    // Force markdown detection for long form articles
    return 'advanced-markdown'
  }

  // Check for AsciiDoc syntax patterns
  const asciidocPatterns = [
    /^=+\s[^=]/,       // Headers: = Title (but not == Requirements ==)
    /^\.+\s/,          // Lists: . item
    /^\[\[/,           // Cross-references: [[ref]]
    /^<</,             // Cross-references: <<ref>>
    /^include::/,      // Includes: include::file[]
    /^image::/,        // Images: image::url[alt,width]
    /^link:/,          // Links: link:url[text]
    /^footnote:/,      // Footnotes: footnote:[text]
    /^NOTE:/,          // Admonitions: NOTE:, TIP:, WARNING:, etc.
    /^TIP:/,
    /^WARNING:/,
    /^IMPORTANT:/,
    /^CAUTION:/,
    /^\[source,/,      // Source blocks: [source,javascript]
    /^----/,           // Delimited blocks: ----, ++++, etc.
    /^\+\+\+\+/,
    /^\|\|/,           // Tables: || cell ||
    /^\[\[.*\]\]/,     // Wikilinks: [[NIP-54]]
  ]

  const hasAsciidocSyntax = asciidocPatterns.some(pattern => pattern.test(content.trim()))
  if (hasAsciidocSyntax) {
    return 'asciidoc'
  }

  // Check for advanced Markdown features
  const advancedMarkdownPatterns = [
    /```[\s\S]*?```/,  // Code blocks
    /`[^`]+`/,         // Inline code
    /^\|.*\|.*\|/,     // Tables
    /\[\^[\w\d]+\]/,   // Footnotes: [^1]
    /\[\^[\w\d]+\]:/,  // Footnote references: [^1]:
    /\[\[[\w\-\s]+\]\]/, // Wikilinks: [[NIP-54]]
    /^==\s+[^=]/,      // Markdown-style headers: == Requirements ==
  ]

  const hasAdvancedMarkdown = advancedMarkdownPatterns.some(pattern => pattern.test(content))
  if (hasAdvancedMarkdown) {
    return 'advanced-markdown'
  }

  // Check for basic Markdown features
  const basicMarkdownPatterns = [
    /^#+\s/,           // Headers: # Title
    /^\*\s/,           // Lists: * item
    /^\d+\.\s/,        // Ordered lists: 1. item
    /\[.*?\]\(.*?\)/,  // Links: [text](url)
    /!\[.*?\]\(.*?\)/, // Images: ![alt](url)
    /^\>\s/,           // Blockquotes: > text
    /\*.*?\*/,         // Bold: *text*
    /_.*?_/,           // Italic: _text_
    /~.*?~/,           // Strikethrough: ~text~
    /#[\w]+/,          // Hashtags: #hashtag
    /:[\w]+:/,         // Emoji: :smile:
  ]

  const hasBasicMarkdown = basicMarkdownPatterns.some(pattern => pattern.test(content))
  if (hasBasicMarkdown) {
    return 'basic-markdown'
  }

  return 'plain-text'
}

/**
 * Get the appropriate CSS classes for the detected markup type
 */
export function getMarkupClasses(markupType: MarkupType): string {
  const baseClasses = "prose prose-zinc max-w-none dark:prose-invert break-words"
  
  switch (markupType) {
    case 'asciidoc':
      return `${baseClasses} asciidoc-content`
    case 'advanced-markdown':
      return `${baseClasses} markdown-content advanced`
    case 'basic-markdown':
      return `${baseClasses} markdown-content basic`
    case 'plain-text':
      return `${baseClasses} plain-text`
    default:
      return baseClasses
  }
}
