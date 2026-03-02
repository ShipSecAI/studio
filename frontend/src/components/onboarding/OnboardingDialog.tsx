import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  Workflow,
  Package,
  CalendarClock,
  Zap,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingStep {
  title: string;
  description: string;
  icon: typeof Sparkles;
  content: string;
  gradient: string;
  iconColor: string;
  target: string | null;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to ShipSec Studio!',
    description: "Let's take a quick tour of the platform.",
    icon: Sparkles,
    content:
      "ShipSec Studio is your all-in-one security automation platform. We'll walk you through the key features to get you started.",
    gradient: 'from-purple-500/20 via-violet-500/10 to-transparent',
    iconColor: 'text-purple-500',
    target: null,
  },
  {
    title: 'Workflow Builder',
    description: 'Your starting point for security automation.',
    icon: Workflow,
    content:
      'Design powerful security workflows using the visual builder. Drag and drop nodes, configure actions, and chain them together.',
    gradient: 'from-blue-500/20 via-blue-500/10 to-transparent',
    iconColor: 'text-blue-500',
    target: '[data-onboarding="workflow-builder"]',
  },
  {
    title: 'Template Library',
    description: 'Get started faster with pre-built templates.',
    icon: Package,
    content:
      'Browse ready-made workflow templates for common security tasks. Pick one and customize it to fit your needs.',
    gradient: 'from-green-500/20 via-green-500/10 to-transparent',
    iconColor: 'text-green-500',
    target: '[data-onboarding="template-library"]',
  },
  {
    title: 'Schedules',
    description: 'Automate workflow execution on a schedule.',
    icon: CalendarClock,
    content:
      'Set up schedules to run workflows at specific intervals. Automate recurring security scans and checks effortlessly.',
    gradient: 'from-orange-500/20 via-orange-500/10 to-transparent',
    iconColor: 'text-orange-500',
    target: '[data-onboarding="schedules"]',
  },
  {
    title: 'Action Center',
    description: 'Monitor and manage workflow results.',
    icon: Zap,
    content:
      'Review workflow executions, inspect findings, and take action on results — all from one central dashboard.',
    gradient: 'from-yellow-500/20 via-yellow-500/10 to-transparent',
    iconColor: 'text-yellow-500',
    target: '[data-onboarding="action-center"]',
  },
  {
    title: 'Manage Settings',
    description: 'Secrets, API Keys, and MCP Servers.',
    icon: KeyRound,
    content:
      'Store API keys, tokens, and credentials securely. Configure MCP servers and manage all your sensitive data from here.',
    gradient: 'from-red-500/20 via-red-500/10 to-transparent',
    iconColor: 'text-red-500',
    target: '[data-onboarding="manage-section"]',
  },
];

const SPOTLIGHT_PADDING = 10;
const TOOLTIP_GAP = 16;
const TOOLTIP_WIDTH = 380;

interface OnboardingDialogProps {
  open: boolean;
  onComplete: () => void;
  currentStep: number;
  onStepChange: (step: number) => void;
}

export function OnboardingDialog({
  open,
  onComplete,
  currentStep,
  onStepChange,
}: OnboardingDialogProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
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

    const tooltipTop = Math.max(
      16,
      Math.min(window.innerHeight - 340, targetRect.top + targetRect.height / 2 - 100),
    );

    const tooltipLeft = targetRect.right + TOOLTIP_GAP;

    if (tooltipLeft + TOOLTIP_WIDTH > window.innerWidth - 16) {
      return {
        top: targetRect.bottom + TOOLTIP_GAP,
        left: Math.max(16, targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2),
        width: TOOLTIP_WIDTH,
      };
    }

    return {
      top: tooltipTop,
      left: tooltipLeft,
      width: TOOLTIP_WIDTH,
    };
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding tour"
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
            {ONBOARDING_STEPS.map((s, index) => (
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
              {currentStep + 1} / {ONBOARDING_STEPS.length}
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
                  'Get Started'
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
