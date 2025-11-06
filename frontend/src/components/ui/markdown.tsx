import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'

type MarkdownViewProps = {
  content: string
  className?: string
  dataTestId?: string
  // When provided, enables interactive task checkboxes and will be called
  // with the updated markdown string after a toggle.
  onEdit?: (next: string) => void
}

// Allow GFM task list checkboxes and safe link attributes
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [
      ...(defaultSchema.attributes?.input || []),
      ['type', 'checkbox'],
      ['disabled', ''],
      ['checked', ''],
    ],
    a: [
      ...(defaultSchema.attributes?.a || []),
      ['target', '_blank'],
      ['rel', 'noopener noreferrer'],
    ],
  },
}

function toggleNthTask(md: string, index: number): string {
  let counter = 0
  return md.replace(/(^|\n)([\t ]*)([-*]|\d+\.)[\t ]+\[( |x|X)\]/g, (match, prefix: string, indent: string, bullet: string, mark: string) => {
    if (counter === index) {
      const next = mark.toLowerCase() === 'x' ? ' ' : 'x'
      counter++
      return `${prefix}${indent}${bullet} [${next}]`
    }
    counter++
    return match
  })
}

export function MarkdownView({ content, className, dataTestId, onEdit }: MarkdownViewProps) {
  // Normalize a common typo "-[ ]" → "- [ ]" so GFM task list renders
  const normalized = content.replace(/(^|\n)[\t ]*-\[( |x|X)\]/g, (_m, prefix, mark) => `${prefix}- [${mark}]`)

  // Sequential index across task inputs for the current render
  let taskCounter = 0

  return (
    <div className={cn('text-xs sm:text-sm text-muted-foreground', className)} data-testid={dataTestId}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          li({ node, children, ...props }) {
            const anyNode: any = node as any
            // For GFM task items, remove list marker spacing
            if (typeof anyNode?.checked === 'boolean') {
              return (
                <li className="list-none pl-0" {...props}>
                  {children}
                </li>
              )
            }
            return <li {...props}>{children}</li>
          },
          a({ node, ...props }) {
            const href = (props.href ?? '').toString()
            return (
              <a {...props} href={href} target="_blank" rel="noopener noreferrer" />
            )
          },
          input({ node, ...props }) {
            if ((props as any).type === 'checkbox') {
              const checkboxIndex = taskCounter++
              const checked = Boolean((props as any).checked)
              const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
                // Capture so pointerup fires on the input even if the cursor leaves the box
                try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch (_) {}
                e.stopPropagation()
              }
              const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
                if (!onEdit) return
                e.preventDefault()
                e.stopPropagation()
                const toggled = toggleNthTask(normalized, checkboxIndex)
                onEdit(toggled)
              }
              return (
                <input
                  type="checkbox"
                  className="align-middle mr-1 nodrag nowheel cursor-pointer"
                  checked={checked}
                  onChange={(e) => e.preventDefault()}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onPointerDown={handlePointerDown}
                  onPointerUpCapture={(e) => e.stopPropagation()}
                  onPointerUp={handlePointerUp}
                  draggable={false}
                  onMouseDownCapture={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUpCapture={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClickCapture={(e) => e.stopPropagation()}
                />
              )
            }
            return <input {...props} />
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownView
