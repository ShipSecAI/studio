import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
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
import { useWorkflowUiStore } from '@/store/workflowUiStore';

interface BuilderTourStep {
  title: string;
  description: string;
  icon: typeof PanelLeft;
  content: string;
  gradient: string;
  iconColor: string;
  target: string | null;
  requiresMode?: 'design' | 'execution';
}

const BUILDER_TOUR_STEPS: BuilderTourStep[] = [
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
    description: 'Publish, Analytics, Import & Export.',
    icon: MoreVertical,
    content:
      'Access undo/redo, publish your workflow as a reusable template, view analytics dashboards, and import/export workflows as JSON.',
    gradient: 'from-red-500/20 via-red-500/10 to-transparent',
    iconColor: 'text-red-500',
    target: '[data-onboarding-builder="more-options"]',
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
  {
    title: 'Execution Inspector',
    description: 'Monitor your workflow runs.',
    icon: MonitorPlay,
    content:
      'This panel shows all your workflow runs. Select a run to explore its timeline, view real-time progress, rerun workflows, and stop active executions.',
    gradient: 'from-cyan-500/20 via-cyan-500/10 to-transparent',
    iconColor: 'text-cyan-500',
    target: '[data-onboarding-builder="execution-inspector"]',
    requiresMode: 'execution',
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
    requiresMode: 'execution',
  },
];

const SPOTLIGHT_PADDING = 10;
const TOOLTIP_GAP = 16;
const TOOLTIP_WIDTH = 380;
const TOOLTIP_WIDTH_NARROW = 320;

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
  const Icon = step?.icon ?? PanelLeft;
  const isCenter = !step?.target;

  // Auto-switch mode based on step requirements
  useEffect(() => {
    if (!open || !step) return;

    const store = useWorkflowUiStore.getState();
    const requiredMode = step.requiresMode;

    if (requiredMode === 'execution' && store.mode !== 'execution') {
      store.setMode('execution');
    } else if (requiredMode !== 'execution' && store.mode === 'execution') {
      store.setMode('design');
    }
  }, [open, currentStep, step]);

  // Continuously track target element position using requestAnimationFrame
  // This handles animations, transitions, resizes, and layout shifts automatically
  useEffect(() => {
    if (!open) {
      setTargetRect(null);
      return;
    }

    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    let rafId: number;
    let running = true;

    // Initial delay for mode-switch steps to allow React re-render
    const delay = step.requiresMode ? 300 : 50;

    const track = () => {
      if (!running) return;
      const el = document.querySelector(step.target!);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect((prev) => {
          // Only update state if the rect actually changed (avoids unnecessary re-renders)
          if (
            !prev ||
            Math.abs(prev.left - rect.left) > 0.5 ||
            Math.abs(prev.top - rect.top) > 0.5 ||
            Math.abs(prev.width - rect.width) > 0.5 ||
            Math.abs(prev.height - rect.height) > 0.5
          ) {
            return rect;
          }
          return prev;
        });
      } else {
        setTargetRect(null);
      }
      rafId = requestAnimationFrame(track);
    };

    const timer = setTimeout(() => {
      track();
    }, delay);

    return () => {
      running = false;
      clearTimeout(timer);
      cancelAnimationFrame(rafId);
    };
  }, [open, step?.target, step?.requiresMode, currentStep]);

  // Wrap onComplete to restore design mode if needed
  const handleComplete = useCallback(() => {
    const currentMode = useWorkflowUiStore.getState().mode;
    if (currentMode === 'execution') {
      useWorkflowUiStore.getState().setMode('design');
    }
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      handleComplete();
    } else {
      onStepChange(currentStep + 1);
    }
  }, [isLastStep, handleComplete, onStepChange, currentStep]);

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
        handleComplete();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleNext, handleBack, handleComplete]);

  if (!open || !step) return null;

  // Compute adjusted spotlight rect: clamp to viewport and expand for parent padding
  const getSpotlightRect = () => {
    if (!targetRect) return null;

    let left = targetRect.left;
    let top = targetRect.top;
    let width = targetRect.width;
    let height = targetRect.height;

    // For inspector elements, expand left to cover the parent's pl-2 (8px) gap
    if (
      step.target === '[data-onboarding-builder="execution-inspector"]' ||
      step.target === '[data-onboarding-builder="inspector-tabs"]'
    ) {
      left -= 8;
      width += 8;
    }

    // Apply padding
    left -= SPOTLIGHT_PADDING;
    top -= SPOTLIGHT_PADDING;
    width += SPOTLIGHT_PADDING * 2;
    height += SPOTLIGHT_PADDING * 2;

    // Clamp to viewport edges (fixes library panel at left edge)
    if (left < 0) {
      width += left; // shrink width by the amount clipped
      left = 0;
    }
    if (top < 0) {
      height += top;
      top = 0;
    }
    if (left + width > window.innerWidth) {
      width = window.innerWidth - left;
    }
    if (top + height > window.innerHeight) {
      height = window.innerHeight - top;
    }

    return { left, top, width, height };
  };

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

    // For the library panel (left side), position tooltip to the right of it
    if (step.target === '[data-onboarding-builder="library-panel"]') {
      const tooltipTop = Math.max(
        80,
        Math.min(window.innerHeight - 340, targetRect.top + targetRect.height / 2 - 100),
      );
      // Try full width first, then narrow width
      const rightEdge = targetRect.right + TOOLTIP_GAP;
      const fitsFullWidth = rightEdge + TOOLTIP_WIDTH <= window.innerWidth - 16;
      const fitsNarrowWidth = rightEdge + TOOLTIP_WIDTH_NARROW <= window.innerWidth - 16;
      const width = fitsFullWidth
        ? TOOLTIP_WIDTH
        : fitsNarrowWidth
          ? TOOLTIP_WIDTH_NARROW
          : Math.max(260, window.innerWidth - rightEdge - 16);

      return {
        top: tooltipTop,
        left: rightEdge,
        width,
      };
    }

    // For inspector elements (right side), position tooltip to the left of it
    if (
      step.target === '[data-onboarding-builder="execution-inspector"]' ||
      step.target === '[data-onboarding-builder="inspector-tabs"]'
    ) {
      const tooltipTop = Math.max(
        80,
        Math.min(window.innerHeight - 340, targetRect.top + targetRect.height / 2 - 100),
      );
      // Try full width first, then narrow width
      const fitsFullWidth = targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH >= 16;
      const fitsNarrowWidth = targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH_NARROW >= 16;
      const width = fitsFullWidth
        ? TOOLTIP_WIDTH
        : fitsNarrowWidth
          ? TOOLTIP_WIDTH_NARROW
          : Math.max(260, targetRect.left - TOOLTIP_GAP - 16);

      return {
        top: tooltipTop,
        left: targetRect.left - TOOLTIP_GAP - width,
        width,
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
        (() => {
          const spot = getSpotlightRect();
          return spot ? (
            <>
              <div
                className="fixed rounded-xl transition-all duration-300 ease-out"
                style={{
                  top: spot.top,
                  left: spot.left,
                  width: spot.width,
                  height: spot.height,
                  boxShadow:
                    '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 30px 8px rgba(99, 102, 241, 0.2)',
                  pointerEvents: 'none',
                }}
              />
              <div
                className="fixed rounded-xl border-2 border-primary/40 transition-all duration-300 ease-out animate-pulse"
                style={{
                  top: spot.top - 2,
                  left: spot.left - 2,
                  width: spot.width + 4,
                  height: spot.height + 4,
                  pointerEvents: 'none',
                }}
              />
            </>
          ) : (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200" />
          );
        })()
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
            onClick={handleComplete}
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
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
              <Button
                variant="link"
                size="sm"
                onClick={handleComplete}
                className="h-8 text-xs text-muted-foreground/60 hover:text-muted-foreground"
              >
                Skip tour
              </Button>
            </div>
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
    </div>,
    document.body,
  );
}
