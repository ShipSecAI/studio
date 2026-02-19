import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * React Error Boundary that catches render-time errors in child components.
 * Use alongside React Query's `isError` for comprehensive error handling.
 */
export class QueryErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm">Something went wrong loading this section.</span>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

/**
 * Inline fallback for failed analytics / data queries.
 * Shows a subtle message instead of leaving widgets stuck in loading.
 */
export function QueryErrorFallback({
  message = 'Data unavailable',
  className = '',
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-muted-foreground justify-center py-4 ${className}`}
    >
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <span className="text-sm">{message}</span>
    </div>
  );
}
