/**
 * Custom browser-compatible markdown-it plugin for image sizing
 * Parses syntax: ![alt](url =WxH) or ![alt](url =W) or ![alt](url =xH)
 *
 * Examples:
 *   ![photo](image.jpg =100x200)    -> width="100" height="200"
 *   ![photo](image.jpg =100x)       -> width="100"
 *   ![photo](image.jpg =x200)       -> height="200"
 *   ![photo](image.jpg =100)        -> width="100"
 */

import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

// Regex to extract size from end of src: " =WxH" or " =W" or " =xH"
const SIZE_REGEX = /\s+=(\d*)x?(\d*)$/

export default function markdownItImsize(md: MarkdownIt): void {
  // Store original image rule
  const originalImage = md.renderer.rules.image

  md.renderer.rules.image = function (tokens: Token[], idx: number, options, env, self) {
    const token = tokens[idx]
    const srcIdx = token.attrIndex('src')

    if (srcIdx >= 0 && token.attrs) {
      const src = token.attrs[srcIdx][1]
      const match = SIZE_REGEX.exec(src)

      if (match) {
        // Remove size suffix from src
        token.attrs[srcIdx][1] = src.replace(SIZE_REGEX, '')

        const width = match[1]
        const height = match[2]

        // Use inline styles to override Tailwind prose "height: auto"
        const styles: string[] = []
        if (width) {
          token.attrSet('width', width)
          styles.push(`width: ${width}px`)
        }
        if (height) {
          token.attrSet('height', height)
          styles.push(`height: ${height}px`)
        }
        if (styles.length > 0) {
          const existingStyle = token.attrGet('style') || ''
          const newStyle = existingStyle ? `${existingStyle}; ${styles.join('; ')}` : styles.join('; ')
          token.attrSet('style', newStyle)
        }
      }
    }

    // Call original renderer or default
    if (originalImage) {
      return originalImage(tokens, idx, options, env, self)
    }
    return self.renderToken(tokens, idx, options)
  }

  // Also need to fix the inline parser to accept URLs with " =WxH" suffix
  // The issue is markdown-it stops parsing URL at the space
  // We need to override the image rule in the inline parser

  // Replace the image parsing rule with one that handles size suffix
  md.inline.ruler.at('image', createImageRuleWithSize())
}

/**
 * Create a modified image rule that parses size suffix
 * Based on markdown-it's default image rule
 */
function createImageRuleWithSize() {
  return function imageWithSize(state: any, silent: boolean): boolean {
    let code: number
    let content: string
    let label: string = ''
    let pos: number
    let ref: any
    let res: any
    let title: string
    let start: number
    let href = ''
    let width = ''
    let height = ''

    const oldPos = state.pos
    const max = state.posMax

    // ![
    if (state.src.charCodeAt(state.pos) !== 0x21 /* ! */) return false
    if (state.src.charCodeAt(state.pos + 1) !== 0x5B /* [ */) return false

    const labelStart = state.pos + 2
    const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false)

    // Parser failed to find ']', so it's not a valid link
    if (labelEnd < 0) return false

    pos = labelEnd + 1

    if (pos < max && state.src.charCodeAt(pos) === 0x28 /* ( */) {
      // Inline link
      pos++

      // Skip whitespace
      for (; pos < max; pos++) {
        code = state.src.charCodeAt(pos)
        if (code !== 0x20 && code !== 0x0A) break
      }
      if (pos >= max) return false

      // Parse link destination with size suffix support
      start = pos
      res = parseLinkDestinationWithSize(state.src, pos, state.posMax)

      if (res.ok) {
        href = state.md.normalizeLink(res.str)
        width = res.width || ''
        height = res.height || ''

        if (state.md.validateLink(href)) {
          pos = res.pos
        } else {
          href = ''
        }
      }

      // Skip whitespace
      start = pos
      for (; pos < max; pos++) {
        code = state.src.charCodeAt(pos)
        if (code !== 0x20 && code !== 0x0A) break
      }

      // Parse title
      res = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax)
      if (pos < max && start !== pos && res.ok) {
        title = res.str
        pos = res.pos

        // Skip whitespace
        for (; pos < max; pos++) {
          code = state.src.charCodeAt(pos)
          if (code !== 0x20 && code !== 0x0A) break
        }
      } else {
        title = ''
      }

      if (pos >= max || state.src.charCodeAt(pos) !== 0x29 /* ) */) {
        state.pos = oldPos
        return false
      }
      pos++
    } else {
      // Reference link
      if (typeof state.env.references === 'undefined') return false

      // Skip whitespace
      for (; pos < max; pos++) {
        code = state.src.charCodeAt(pos)
        if (code !== 0x20 && code !== 0x0A) break
      }

      if (pos < max && state.src.charCodeAt(pos) === 0x5B /* [ */) {
        start = pos + 1
        pos = state.md.helpers.parseLinkLabel(state, pos)
        if (pos >= 0) {
          label = state.src.slice(start, pos++)
        } else {
          pos = labelEnd + 1
        }
      } else {
        pos = labelEnd + 1
      }

      // Covers label === '' and label === undefined
      if (!label) label = state.src.slice(labelStart, labelEnd)

      ref = state.env.references[state.md.utils.normalizeReference(label)]
      if (!ref) {
        state.pos = oldPos
        return false
      }
      href = ref.href
      title = ref.title || ''
    }

    // We found the end of the link, can confirm it's valid
    if (!silent) {
      content = state.src.slice(labelStart, labelEnd)

      const tokens: Token[] = []
      state.md.inline.parse(content, state.md, state.env, tokens)

      const token = state.push('image', 'img', 0)
      token.attrs = [['src', href], ['alt', '']]
      token.children = tokens
      token.content = content

      if (title) {
        token.attrs.push(['title', title])
      }

      // Use inline styles for sizing to override Tailwind prose "height: auto"
      // HTML attributes alone get overridden by CSS rules
      if (width || height) {
        const styles: string[] = []
        if (width) {
          styles.push(`width: ${width}px`)
          token.attrs.push(['width', width])
        }
        if (height) {
          styles.push(`height: ${height}px`)
          token.attrs.push(['height', height])
        }
        token.attrs.push(['style', styles.join('; ')])
      }
    }

    state.pos = pos
    state.posMax = max
    return true
  }
}

/**
 * Parse link destination that may include size suffix like " =100x200"
 */
function parseLinkDestinationWithSize(str: string, pos: number, max: number) {
  let code: number
  let level = 0
  const start = pos
  let width = ''
  let height = ''

  // Check for angle brackets
  if (str.charCodeAt(pos) === 0x3C /* < */) {
    pos++
    while (pos < max) {
      code = str.charCodeAt(pos)
      if (code === 0x0A /* \n */) return { ok: false, pos: 0, str: '' }
      if (code === 0x3E /* > */) {
        const result = extractSize(str.slice(start + 1, pos))
        return {
          ok: true,
          pos: pos + 1,
          str: result.url,
          width: result.width,
          height: result.height,
        }
      }
      if (code === 0x5C /* \ */ && pos + 1 < max) {
        pos += 2
        continue
      }
      pos++
    }
    return { ok: false, pos: 0, str: '' }
  }

  // Regular link destination - need to find where URL ends
  // Look for closing ) but handle nested parens
  while (pos < max) {
    code = str.charCodeAt(pos)

    if (code === 0x20 /* space */) {
      // Check if this is a size suffix
      const remaining = str.slice(pos, max)
      const sizeMatch = remaining.match(/^\s+=(\d*)x?(\d*)\s*\)/)
      if (sizeMatch) {
        // Found size suffix, extract it
        width = sizeMatch[1] || ''
        height = sizeMatch[2] || ''
        break
      }
      // Otherwise, space ends the URL
      break
    }

    if (code === 0x29 /* ) */) {
      if (level === 0) break
      level--
    }

    if (code === 0x28 /* ( */) {
      level++
    }

    if (code === 0x5C /* \ */ && pos + 1 < max) {
      pos += 2
      continue
    }

    pos++
  }

  if (start === pos) return { ok: false, pos: 0, str: '' }
  if (level !== 0) return { ok: false, pos: 0, str: '' }

  const url = str.slice(start, pos)

  // Skip past the size suffix if present
  if (width || height) {
    const remaining = str.slice(pos)
    const skipMatch = remaining.match(/^\s+=\d*x?\d*/)
    if (skipMatch) {
      pos += skipMatch[0].length
    }
  }

  return { ok: true, pos, str: url, width, height }
}

/**
 * Extract size from URL string (for angle bracket links)
 */
function extractSize(url: string) {
  const match = url.match(/^(.+?)\s+=(\d*)x?(\d*)$/)
  if (match) {
    return {
      url: match[1],
      width: match[2] || '',
      height: match[3] || '',
    }
  }
  return { url, width: '', height: '' }
}
