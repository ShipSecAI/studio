import React from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resetOnNavigate?: boolean;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends React.Component<
  ErrorBoundaryProps & { resetKey?: string },
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps & { resetKey?: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', {
      name: error.name,
      message: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps & { resetKey?: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.handleReset();
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = import.meta.env.DEV;
      const error = this.state.error;

      return (
        <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-4 p-8">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground text-center max-w-md">
            {isDev && error
              ? error.message
              : 'An unexpected error occurred. Please try again or return to the home page.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Try Again
            </button>
            <a
              href="/"
              className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
            >
              Go Home
            </a>
          </div>
          {isDev && error?.stack && (
            <details className="mt-4 w-full max-w-2xl">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Stack trace
              </summary>
              <pre className="mt-2 p-4 rounded-md bg-muted text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

function ResetOnNavigateWrapper(props: ErrorBoundaryProps & { resetKey?: string }) {
  const location = useLocation();
  const resetKey = location.pathname + location.search;
  return <ErrorBoundaryInner {...props} resetKey={resetKey} />;
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  if (props.resetOnNavigate) {
    return <ResetOnNavigateWrapper {...props} />;
  }
  return <ErrorBoundaryInner {...props} />;
}
