import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AnsiUp } from 'ansi_up';

interface MessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
}

export function MessageModal({ open, onOpenChange, title, message }: MessageModalProps) {
  // eslint-disable-next-line no-control-regex
  const hasAnsi = /\u001b\[[0-9;]*m/.test(message);
  const [wrap, setWrap] = useState(true);
  const [colorize, setColorize] = useState(true);

  // Load persisted prefs on mount; default colorize to hasAnsi if unset
  useEffect(() => {
    try {
      const w = localStorage.getItem('messageModal.wrap');
      if (w !== null) setWrap(w === '1');
      const c = localStorage.getItem('messageModal.color');
      if (c !== null) setColorize(c === '1');
      else setColorize(hasAnsi);
    } catch {
      // Ignore localStorage errors (e.g., in iframes or when cookies disabled)
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('messageModal.wrap', wrap ? '1' : '0');
    } catch {
      // Ignore localStorage errors (e.g., in iframes or when cookies disabled)
    }
  }, [wrap]);
  useEffect(() => {
    try {
      localStorage.setItem('messageModal.color', colorize ? '1' : '0');
    } catch {
      // Ignore localStorage errors (e.g., in iframes or when cookies disabled)
    }
  }, [colorize]);

  const ansiHtml = useMemo(() => {
    if (!(colorize && hasAnsi)) return '';
    const au = new AnsiUp();
    return au.ansi_to_html(message);
  }, [colorize, hasAnsi, message]);
  const copyToClipboard = () => {
    navigator.clipboard.writeText(message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Full message content</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {colorize && hasAnsi ? (
            <div
              className={`text-xs font-mono bg-muted/30 rounded p-3 border min-h-[200px] ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'}`}
              dangerouslySetInnerHTML={{ __html: ansiHtml }}
            />
          ) : (
            <pre
              className={`text-xs font-mono bg-muted/30 rounded p-3 border min-h-[200px] ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'}`}
            >
              {message}
            </pre>
          )}
        </div>

        <div className="flex justify-between items-center pt-4">
          <div className="flex items-center gap-2">
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
              variant={wrap ? 'default' : 'outline'}
              size="sm"
              onClick={() => setWrap((v) => !v)}
              aria-pressed={wrap}
              title="Toggle word wrap"
            >
              Wrap: {wrap ? 'On' : 'Off'}
            </Button>
            <Button
              variant={colorize ? 'default' : 'outline'}
              size="sm"
              onClick={() => setColorize((v) => !v)}
              aria-pressed={colorize}
              title="Toggle ANSI colorization"
              disabled={!hasAnsi}
            >
              Colorize: {colorize && hasAnsi ? 'On' : 'Off'}
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
