import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Circle, ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';

export interface ChecklistStep {
  label: string;
  description: string;
  done: boolean;
  href: string;
  icon: string;
}

interface GettingStartedChecklistProps {
  checklist: ChecklistStep[];
  completedCount: number;
  /** 'expanded' = card grid (State 1), 'compact' = collapsible list (State 2) */
  mode: 'expanded' | 'compact';
  defaultOpen?: boolean;
}

export const CHECKLIST_ICONS = {
  github: '/icons/github.svg',
  aws: '/icons/aws.svg',
  scan: '/icons/nuclei.svg',
  prGate: '/icons/github.svg',
  template: '/icons/ai.svg',
};

export function GettingStartedChecklist({
  checklist,
  completedCount,
  mode,
  defaultOpen = true,
}: GettingStartedChecklistProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const total = checklist.length;
  const progressPercent = (completedCount / total) * 100;
  const collapsible = completedCount > 0;

  if (mode === 'expanded') {
    return (
      <Card>
        <CardHeader className={collapsible && !isOpen ? 'py-3' : 'pb-3'}>
          <div className="flex items-center justify-between">
            {collapsible ? (
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <CardTitle className="text-base">Getting Started</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {completedCount}/{total}
                </span>
                <div className="flex-1 max-w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
            ) : (
              <>
                <CardTitle className="text-base">Getting Started</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {completedCount}/{total}
                </span>
              </>
            )}
          </div>
          {/* Progress bar — only show standalone when not collapsible */}
          {!collapsible && (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </CardHeader>
        {(!collapsible || isOpen) && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {checklist.map((step) => {
                return (
                  <Link
                    key={step.label}
                    to={step.href}
                    className={`group relative flex flex-col items-center rounded-lg border p-4 text-center transition-[background-color,border-color] hover:border-primary/35 hover:bg-muted/35 ${
                      step.done ? 'border-border bg-muted/25' : 'border-border'
                    }`}
                  >
                    <div
                      className={`mb-2 flex h-10 w-10 items-center justify-center rounded-lg border ${
                        step.done ? 'bg-muted/40 opacity-70' : 'bg-muted'
                      }`}
                    >
                      <img
                        src={step.icon}
                        alt={step.label}
                        className={`h-5 w-5 ${step.done ? 'opacity-50' : ''}`}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium ${step.done ? 'text-muted-foreground line-through' : ''}`}
                    >
                      {step.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {step.description}
                    </span>
                    {step.done && (
                      <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-success" />
                    )}
                  </Link>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  // Compact mode (collapsible list)
  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <CardTitle className="text-sm">Getting Started</CardTitle>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{total}
            </span>
            <div className="flex-1 max-w-32 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-1.5 pt-0">
          {checklist.map((step) => (
            <Link
              key={step.label}
              to={step.href}
              className="flex items-center gap-3 text-sm hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors"
            >
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
              )}
              <span className={`text-xs ${step.done ? 'text-muted-foreground line-through' : ''}`}>
                {step.label}
              </span>
              {!step.done && <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto" />}
            </Link>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
