import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'
import { AnsiUp } from 'ansi_up'

interface MessageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: string
}

export function MessageModal({ open, onOpenChange, title, message }: MessageModalProps) {
  const hasAnsi = /\u001b\[[0-9;]*m/.test(message)
  const au = new AnsiUp()
  const ansiHtml = hasAnsi ? au.ansi_to_html(message) : ''
  const copyToClipboard = () => {
    navigator.clipboard.writeText(message)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Full message content
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {hasAnsi ? (
            <div
              className="text-xs font-mono whitespace-pre-wrap break-words bg-muted/30 rounded p-3 border"
              dangerouslySetInnerHTML={{ __html: ansiHtml }}
            />
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-muted/30 rounded p-3 border">
              {message}
            </pre>
          )}
        </div>

        <div className="flex justify-between items-center pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={copyToClipboard}
            className="flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            Copy to clipboard
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
