// Lightweight Markdown renderer for node annotations
// - Escapes HTML by default
// - Supports headings (# .. ######), paragraphs, inline code, bold, italic and links
// - Handles basic unordered lists (- item)
// This is intentionally minimal to avoid extra deps; extend if needed.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function applyInline(md: string): string {
  // Inline code
  let out = md.replace(/`([^`]+?)`/g, '<code>$1</code>')
  // Bold (strong)
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+?)__/g, '<strong>$1</strong>')
  // Italic (em)
  out = out.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_]+?)_(?!_)/g, '$1<em>$2</em>')
  // Links [text](https://example)
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return out
}

export function renderMarkdownToHtml(input: string): string {
  const text = input.replace(/\r\n?/g, '\n')

  const lines = text.split('\n')
  const blocks: string[] = []
  let i = 0
  let inCodeBlock = false
  let codeBuffer: string[] = []

  const flushCode = () => {
    if (codeBuffer.length > 0) {
      const codeText = escapeHtml(codeBuffer.join('\n'))
      blocks.push(`<pre><code>${codeText}</code></pre>`) 
      codeBuffer = []
    }
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()

    // Code fence ```
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
      } else {
        inCodeBlock = false
        flushCode()
      }
      i++
      continue
    }

    if (inCodeBlock) {
      codeBuffer.push(raw)
      i++
      continue
    }

    // Unordered list group
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '')
        const safe = escapeHtml(itemText)
        items.push(`<li>${applyInline(safe)}</li>`) 
        i++
      }
      blocks.push(`<ul>${items.join('')}</ul>`) 
      continue
    }

    if (line.trim().length === 0) {
      // Blank line separates paragraphs
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length)
      const content = headingMatch[2]
      const safe = escapeHtml(content)
      blocks.push(`<h${level}>${applyInline(safe)}</h${level}>`)
      i++
      continue
    }

    // Paragraph
    const safeLine = escapeHtml(line)
    blocks.push(`<p>${applyInline(safeLine)}</p>`) 
    i++
  }

  // Flush any dangling code block (unterminated)
  flushCode()
  return blocks.join('\n')
}

export default renderMarkdownToHtml

