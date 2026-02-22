import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';

interface ObjectViewerProps {
  data: unknown;
  className?: string;
}

export function ObjectViewer({ data, className }: ObjectViewerProps) {
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof data === 'boolean') {
    return (
      <Badge
        variant="outline"
        className={cn('text-xs font-mono', data ? 'text-green-500' : 'text-red-500')}
      >
        {data ? 'true' : 'false'}
      </Badge>
    );
  }

  if (typeof data === 'number') {
    return <span className="text-blue-500 font-mono">{data}</span>;
  }

  if (typeof data === 'string') {
    // Check if it's a URL or path that might look better as just a string
    // Or if it's a multiline string
    if (data.includes('\n')) {
      return (
        <pre className="text-xs bg-background/50 p-2 rounded border border-border/50 text-foreground overflow-x-auto whitespace-pre-wrap">
          {data}
        </pre>
      );
    }
    return (
      <span className="text-green-600 dark:text-green-400 break-words">&quot;{data}&quot;</span>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }

    // Check if array of strings/numbers
    const isSimpleArray = data.every(
      (item) => typeof item === 'string' || typeof item === 'number',
    );
    if (isSimpleArray) {
      return (
        <div className="flex flex-wrap gap-1">
          {data.map((item, i) => (
            <Badge key={i} variant="secondary" className="font-mono text-xs">
              {item}
            </Badge>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="pl-3 border-l-2 border-border/40 py-1">
            <ObjectViewer data={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return <span className="text-muted-foreground">{'{}'}</span>;
    }

    return (
      <div className={cn('grid grid-cols-1 gap-2', className)}>
        {keys.map((key) => {
          const value = (data as Record<string, unknown>)[key];
          const isComplex =
            typeof value === 'object' && value !== null && Object.keys(value).length > 0;

          return (
            <div
              key={key}
              className={cn(
                'text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0',
                isComplex ? 'block' : 'flex items-start gap-4',
              )}
            >
              <span className="font-medium text-muted-foreground min-w-[120px] shrink-0 font-mono tracking-tight">
                {key}
              </span>
              <div className={cn('min-w-0 flex-1', isComplex ? 'mt-2 pl-2' : '')}>
                <ObjectViewer data={value} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}
