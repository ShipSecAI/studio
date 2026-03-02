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
  X,
  MonitorPlay,
  LayoutList,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuilderTourStep {
  title: string;
  description: string;
  icon: typeof Sparkles;
  content: string;
  gradient: string;
  iconColor: string;
  target: string | null;
}

const BUILDER_TOUR_STEPS: BuilderTourStep[] = [
  {
    title: 'Welcome to the Workflow Builder!',
    description: "Let's explore how to build workflows.",
    icon: Sparkles,
    content:
      "This is where you design and execute security workflows. We'll walk you through each part of the builder interface.",
    gradient: 'from-purple-500/20 via-violet-500/10 to-transparent',
    iconColor: 'text-purple-500',
    target: null,
  },
  {
    title: 'Component Library',
    description: 'Drag and drop nodes onto the canvas.',
    icon: PanelLeft,
    content:
      'Browse available components here — entry points, actions, conditions, and more. Drag any component onto the canvas to add it to your workflow.',
    gradient: 'from-blue-500/20 via-blue-500/10 to-transparent',
    iconColor: 'text-blue-500',
    target: '[data-onboarding-builder="library-panel"]',
  },
  {
    title: 'Canvas',
    description: 'Your workflow design surface.',
    icon: MousePointerSquareDashed,
    content:
      'This is where your workflow comes to life. Connect nodes by dragging from one handle to another. Pan and zoom to navigate larger workflows.',
    gradient: 'from-emerald-500/20 via-emerald-500/10 to-transparent',
    iconColor: 'text-emerald-500',
    target: '[data-onboarding-builder="canvas"]',
  },
  {
    title: 'Design & Execute Modes',
    description: 'Switch between building and running.',
    icon: PencilLine,
    content:
      'Use Design mode to build your workflow. Switch to Execute mode to run it, inspect past executions, and view real-time logs.',
    gradient: 'from-indigo-500/20 via-indigo-500/10 to-transparent',
    iconColor: 'text-indigo-500',
    target: '[data-onboarding-builder="mode-toggle"]',
  },
  {
    title: 'Save Workflow',
    description: 'Persist your changes.',
    icon: Save,
    content:
      'Save your workflow at any time. The status badge shows whether changes are synced, pending, or currently saving. Use Cmd+S for a quick save.',
    gradient: 'from-amber-500/20 via-amber-500/10 to-transparent',
    iconColor: 'text-amber-500',
    target: '[data-onboarding-builder="save-button"]',
  },
  {
    title: 'Run Workflow',
    description: 'Execute your workflow instantly.',
    icon: Play,
    content:
      'Click Run to execute your workflow. If your workflow has runtime inputs, a dialog will prompt you to fill them in before execution starts.',
    gradient: 'from-green-500/20 via-green-500/10 to-transparent',
    iconColor: 'text-green-500',
    target: '[data-onboarding-builder="run-button"]',
  },
  {
    title: 'More Options',
    description: 'Undo, Redo, Import & Export.',
    icon: MoreVertical,
    content:
      'Access undo/redo (Cmd+Z / Cmd+Shift+Z), import workflows from JSON files, or export your current workflow for sharing and backup.',
    gradient: 'from-red-500/20 via-red-500/10 to-transparent',
    iconColor: 'text-red-500',
    target: '[data-onboarding-builder="more-options"]',
  },
  {
    title: 'Execution Inspector',
    description: 'Monitor your workflow runs.',
    icon: MonitorPlay,
    content:
      'Switch to Execute mode to see this panel. Select a run to explore its timeline, view real-time progress, rerun workflows, and stop active executions.',
    gradient: 'from-cyan-500/20 via-cyan-500/10 to-transparent',
    iconColor: 'text-cyan-500',
    target: '[data-onboarding-builder="execution-inspector"]',
  },
  {
    title: 'Inspector Tabs',
    description: 'Events, Logs, Agent, Artifacts, I/O & Network.',
    icon: LayoutList,
    content:
      'Dive deep into each run with six inspector tabs — view execution events, stream logs in real-time, trace agent activity, browse artifacts, inspect node I/O, and monitor network calls.',
    gradient: 'from-violet-500/20 via-violet-500/10 to-transparent',
    iconColor: 'text-violet-500',
    target: '[data-onboarding-builder="inspector-tabs"]',
  },
  {
    title: 'Schedules',
    description: 'Automate recurring workflow runs.',
    icon: CalendarClock,
    content:
      'Create and manage schedules to run your workflow automatically at set intervals. View active, paused, and errored schedules right from the canvas.',
    gradient: 'from-teal-500/20 via-teal-500/10 to-transparent',
    iconColor: 'text-teal-500',
    target: '[data-onboarding-builder="schedule-bar"]',
  },
];

const SPOTLIGHT_PADDING = 10;
const TOOLTIP_GAP = 16;
const TOOLTIP_WIDTH = 380;

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

    const timer = setTimeout(() => {
      const el = document.querySelector(step.target!);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    }, 120);

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
      <div className="fixed inset-0" aria-hidden="true" />

      {isCenter || !targetRect ? (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200" />
      ) : (
        <>
          <div
            className="fixed rounded-xl transition-all duration-300 ease-out"
            style={{
              top: targetRect.top - SPOTLIGHT_PADDING,
              left: targetRect.left - SPOTLIGHT_PADDING,
              width: targetRect.width + SPOTLIGHT_PADDING * 2,
              height: targetRect.height + SPOTLIGHT_PADDING * 2,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 30px 8px rgba(99, 102, 241, 0.2)',
              pointerEvents: 'none',
            }}
          />
          <div
            className="fixed rounded-xl border-2 border-primary/40 transition-all duration-300 ease-out animate-pulse"
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
        className="fixed rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl transition-all duration-200 overflow-hidden"
        style={getTooltipStyle()}
      >
        {/* Gradient header */}
        <div className={cn('bg-gradient-to-br px-5 pt-5 pb-4', step.gradient)}>
          {/* Close button */}
          <button
            onClick={onComplete}
            className="absolute top-3 right-3 p-1 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Step content */}
          <div key={currentStep} className="animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/80 shadow-sm border border-border/40">
                <Icon className={cn('h-5 w-5', step.iconColor)} />
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="font-semibold text-foreground text-[15px] leading-tight">
                  {step.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              </div>
            </div>

            <p className="text-[13px] leading-relaxed text-muted-foreground">{step.content}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/40 bg-muted/20">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-3" role="tablist">
            {BUILDER_TOUR_STEPS.map((s, index) => (
              <button
                key={index}
                role="tab"
                aria-selected={index === currentStep}
                aria-label={`Step ${index + 1}: ${s.title}`}
                onClick={() => onStepChange(index)}
                className={cn(
                  'rounded-full transition-all duration-200 hover:opacity-80',
                  index === currentStep
                    ? 'w-6 h-2 bg-primary'
                    : index < currentStep
                      ? 'w-2 h-2 bg-primary/50'
                      : 'w-2 h-2 bg-muted-foreground/20',
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {currentStep + 1} / {BUILDER_TOUR_STEPS.length}
            </span>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </Button>
              )}
              <Button size="sm" onClick={handleNext} className="h-8 text-xs gap-1 px-4 shadow-sm">
                {isLastStep ? (
                  'Start Building'
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-3 w-3" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
