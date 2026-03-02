import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  PanelLeft,
  MousePointerSquareDashed,
  PencilLine,
  Save,
  Play,
  MoreVertical,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuilderTourStep {
  title: string;
  description: string;
  icon: typeof Sparkles;
  content: string;
  color: string;
  target: string | null;
}

const BUILDER_TOUR_STEPS: BuilderTourStep[] = [
  {
    title: 'Welcome to the Workflow Builder!',
    description: "Let's explore how to build workflows.",
    icon: Sparkles,
    content:
      "This is where you design and execute security workflows. We'll walk you through each part of the builder interface.",
    color: 'text-purple-500',
    target: null,
  },
  {
    title: 'Component Library',
    description: 'Drag and drop nodes onto the canvas.',
    icon: PanelLeft,
    content:
      'Browse available components here — entry points, actions, conditions, and more. Drag any component onto the canvas to add it to your workflow.',
    color: 'text-blue-500',
    target: '[data-onboarding-builder="library-panel"]',
  },
  {
    title: 'Canvas',
    description: 'Your workflow design surface.',
    icon: MousePointerSquareDashed,
    content:
      'This is where your workflow comes to life. Connect nodes by dragging from one handle to another. Pan and zoom to navigate larger workflows.',
    color: 'text-emerald-500',
    target: '[data-onboarding-builder="canvas"]',
  },
  {
    title: 'Design & Execute Modes',
    description: 'Switch between building and running.',
    icon: PencilLine,
    content:
      'Use Design mode to build your workflow. Switch to Execute mode to run it, inspect past executions, and view real-time logs.',
    color: 'text-indigo-500',
    target: '[data-onboarding-builder="mode-toggle"]',
  },
  {
    title: 'Save Workflow',
    description: 'Persist your changes.',
    icon: Save,
    content:
      'Save your workflow at any time. The status badge shows whether changes are synced, pending, or currently saving. Use Cmd+S for a quick save.',
    color: 'text-amber-500',
    target: '[data-onboarding-builder="save-button"]',
  },
  {
    title: 'Run Workflow',
    description: 'Execute your workflow instantly.',
    icon: Play,
    content:
      'Click Run to execute your workflow. If your workflow has runtime inputs, a dialog will prompt you to fill them in before execution starts.',
    color: 'text-green-500',
    target: '[data-onboarding-builder="run-button"]',
  },
  {
    title: 'More Options',
    description: 'Undo, Redo, Import & Export.',
    icon: MoreVertical,
    content:
      'Access undo/redo (Cmd+Z / Cmd+Shift+Z), import workflows from JSON files, or export your current workflow for sharing and backup.',
    color: 'text-red-500',
    target: '[data-onboarding-builder="more-options"]',
  },
];

const SPOTLIGHT_PADDING = 8;
const TOOLTIP_GAP = 16;
const TOOLTIP_WIDTH = 360;

interface WorkflowBuilderTourProps {
  open: boolean;
  onComplete: () => void;
  currentStep: number;
  onStepChange: (step: number) => void;
}

export function WorkflowBuilderTour({
  open,
  onComplete,
  currentStep,
  onStepChange,
}: WorkflowBuilderTourProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = BUILDER_TOUR_STEPS[currentStep];
  const isLastStep = currentStep === BUILDER_TOUR_STEPS.length - 1;
  const Icon = step?.icon ?? Sparkles;
  const isCenter = !step?.target;

  // Track target element position
  useEffect(() => {
    if (!open) {
      setTargetRect(null);
      return;
    }

    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    // Delay to allow panel animations to settle
    const timer = setTimeout(() => {
      const el = document.querySelector(step.target!);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [open, step?.target, currentStep]);

  // Update on window resize
  useEffect(() => {
    if (!open || !step?.target) return;

    const updateRect = () => {
      const el = document.querySelector(step.target!);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      }
    };

    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [open, step?.target]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      onStepChange(currentStep + 1);
    }
  }, [isLastStep, onComplete, onStepChange, currentStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      onStepChange(currentStep - 1);
    }
  }, [currentStep, onStepChange]);

  // Global keyboard handler
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleBack();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onComplete();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleNext, handleBack, onComplete]);

  if (!open || !step) return null;

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (isCenter || !targetRect) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: TOOLTIP_WIDTH,
      };
    }

    // For the canvas (large element), position in the center of it
    if (step.target === '[data-onboarding-builder="canvas"]') {
      return {
        top: targetRect.top + targetRect.height / 2 - 100,
        left: targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2,
        width: TOOLTIP_WIDTH,
      };
    }

    // For the library panel, position to the right
    if (step.target === '[data-onboarding-builder="library-panel"]') {
      const tooltipTop = Math.max(80, targetRect.top + targetRect.height / 2 - 100);
      return {
        top: tooltipTop,
        left: targetRect.right + TOOLTIP_GAP,
        width: TOOLTIP_WIDTH,
      };
    }

    // For top-bar elements, position below
    const tooltipLeft = Math.max(
      16,
      Math.min(
        window.innerWidth - TOOLTIP_WIDTH - 16,
        targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2,
      ),
    );

    return {
      top: targetRect.bottom + TOOLTIP_GAP,
      left: tooltipLeft,
      width: TOOLTIP_WIDTH,
    };
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-label="Workflow Builder tour"
    >
      {/* Click blocker overlay */}
      <div className="fixed inset-0" aria-hidden="true" />

      {/* Dimming overlay or spotlight */}
      {isCenter || !targetRect ? (
        <div className="fixed inset-0 bg-black/60 transition-opacity duration-300" />
      ) : (
        <>
          {/* Spotlight cutout with smooth transition */}
          <div
            className="fixed rounded-lg transition-all duration-500 ease-in-out"
            style={{
              top: targetRect.top - SPOTLIGHT_PADDING,
              left: targetRect.left - SPOTLIGHT_PADDING,
              width: targetRect.width + SPOTLIGHT_PADDING * 2,
              height: targetRect.height + SPOTLIGHT_PADDING * 2,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 20px 4px rgba(59, 130, 246, 0.25)',
              pointerEvents: 'none',
            }}
          />
          {/* Pulsing ring around spotlight */}
          <div
            className="fixed rounded-lg border-2 border-primary/50 transition-all duration-500 ease-in-out animate-pulse"
            style={{
              top: targetRect.top - SPOTLIGHT_PADDING - 2,
              left: targetRect.left - SPOTLIGHT_PADDING - 2,
              width: targetRect.width + SPOTLIGHT_PADDING * 2 + 4,
              height: targetRect.height + SPOTLIGHT_PADDING * 2 + 4,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className={cn(
          'fixed rounded-xl border bg-background shadow-2xl transition-all duration-300',
          isCenter ? 'p-6' : 'p-5',
        )}
        style={getTooltipStyle()}
      >
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-4" role="tablist">
          {BUILDER_TOUR_STEPS.map((s, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={index === currentStep}
              aria-label={`Step ${index + 1}: ${s.title}`}
              onClick={() => onStepChange(index)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300 hover:opacity-80',
                index <= currentStep ? 'bg-primary' : 'bg-muted',
                index === currentStep ? 'w-6' : 'w-1.5',
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div key={currentStep} className="animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className={cn('h-5 w-5', step.color)} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground text-sm leading-tight">{step.title}</h3>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground mb-4">{step.content}</p>
        </div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onComplete}
            className="text-muted-foreground text-xs h-8"
          >
            Skip tour
          </Button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button variant="outline" size="sm" onClick={handleBack} className="h-8 text-xs">
                <ArrowLeft className="mr-1 h-3 w-3" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={handleNext} className="h-8 text-xs">
              {isLastStep ? (
                'Start Building'
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-1 h-3 w-3" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Step counter */}
        <div className="text-center mt-2">
          <span className="text-[11px] text-muted-foreground/70">
            {currentStep + 1} of {BUILDER_TOUR_STEPS.length}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
