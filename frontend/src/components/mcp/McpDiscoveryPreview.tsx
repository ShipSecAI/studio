import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

export type DiscoveryStatus = 'pending' | 'discovering' | 'completed' | 'failed';

export interface DiscoveryServerResult {
  name: string;
  transportType: 'http' | 'stdio';
  toolCount: number;
  tools?: { name: string; description?: string }[];
  error?: string;
  status?: DiscoveryStatus;
}

interface McpDiscoveryPreviewProps {
  results: DiscoveryServerResult[];
  currentIndex?: number;
  onClear?: () => void;
  showClearButton?: boolean;
}

export function McpDiscoveryPreview({
  results,
  currentIndex = -1,
  onClear,
  showClearButton = true,
}: McpDiscoveryPreviewProps) {
  if (results.length === 0) {
    return null;
  }

  const completedCount = results.filter((r) => r.status === 'completed').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const inProgress = results.some((r) => r.status === 'discovering');

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {inProgress ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
          ) : failedCount === 0 && completedCount === results.length ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : completedCount === 0 && failedCount === results.length ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : null}
          <h4 className="text-sm font-medium">
            {inProgress ? 'Discovering...' : 'Discovery Results'}
          </h4>
          <span className="text-xs text-muted-foreground">
            ({completedCount} success, {failedCount} failed
            {inProgress && `, ${currentIndex + 1}/${results.length} testing`})
          </span>
        </div>
        {showClearButton && onClear && !inProgress && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {results.map((result, idx) => (
          <div
            key={idx}
            className={cn(
              'flex items-center justify-between text-sm rounded-md border p-2 transition-colors',
              result.status === 'discovering' &&
                'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800',
              result.status === 'completed' &&
                'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
              result.status === 'failed' && 'bg-destructive/10 border-destructive/20',
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {result.status === 'discovering' && (
                <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400 flex-shrink-0" />
              )}
              {result.status === 'completed' && (
                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
              )}
              {result.status === 'failed' && (
                <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />
              )}
              {result.status === 'pending' && (
                <div className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
              )}
              <Badge variant="outline" className="text-xs">
                {result.transportType.toUpperCase()}
              </Badge>
              <span className="font-medium truncate">{result.name}</span>
            </div>
            {result.status === 'discovering' && (
              <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap ml-2">
                Connecting...
              </span>
            )}
            {result.status === 'pending' && (
              <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                Waiting...
              </span>
            )}
            {result.error && (
              <span className="text-destructive text-xs truncate ml-2" title={result.error}>
                {result.error}
              </span>
            )}
            {result.status === 'completed' && !result.error && (
              <span className="text-muted-foreground text-xs whitespace-nowrap ml-2">
                {result.toolCount} tool{result.toolCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Import cn for conditional classes
import { cn } from '@/lib/utils';
