import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Compass, Home } from 'lucide-react';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto flex min-h-[calc(100dvh-3.25rem)] max-w-5xl items-center px-4 py-12">
        <section className="grid w-full gap-8 rounded-xl border bg-card/80 p-6 shadow-sm md:grid-cols-[minmax(0,1fr)_18rem] md:p-8">
          <div>
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border bg-muted/70">
              <Compass className="h-5 w-5 text-primary" />
            </div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Route not found
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              This page is not in the current product map
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              The route may have moved into a clearer surface, or the link may be stale.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => navigate('/')} className="gap-2">
                <Home className="h-4 w-4" />
                Go home
              </Button>
              <Button onClick={() => navigate(-1)} variant="outline" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Go back
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-center rounded-lg border bg-background/70 p-6">
            <span className="font-mono text-6xl font-semibold tracking-tight text-primary/25">
              404
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
