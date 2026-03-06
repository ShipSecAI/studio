import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import { useUpdateOnboardingPreferences } from '@/hooks/queries/useOnboardingQueries';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTourStore, type TourId } from './store';
import { tourDefinitions, type TooltipPlacement } from './tours';

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const TOOLTIP_GAP = 16;
const TOOLTIP_WIDTH = 380;
const TOOLTIP_WIDTH_SMALL = 320;

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildSpotlightPath(
  vw: number,
  vh: number,
  rect: TargetRect | null,
  padding: number,
  radius: number,
): string {
  const outer = `M 0 0 H ${vw} V ${vh} H 0 Z`;

  if (!rect) return outer;

  const x = rect.x - padding;
  const y = rect.y - padding;
  const w = rect.width + padding * 2;
  const h = rect.height + padding * 2;
  const r = Math.min(radius, w / 2, h / 2);

  const inner = [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');

  return `${outer} ${inner}`;
}

function calculateTooltipPosition(
  rect: TargetRect | null,
  placement: TooltipPlacement,
  tooltipWidth: number,
  tooltipHeight: number,
): { x: number; y: number; actualPlacement: TooltipPlacement } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect) {
    return {
      x: Math.max(16, (vw - tooltipWidth) / 2),
      y: Math.max(16, (vh - tooltipHeight) / 2 - 40),
      actualPlacement: 'bottom',
    };
  }

  const pad = SPOTLIGHT_PADDING + TOOLTIP_GAP;
  let x: number;
  let y: number;
  let actualPlacement = placement;

  switch (placement) {
    case 'bottom': {
      x = rect.x + rect.width / 2 - tooltipWidth / 2;
      y = rect.y + rect.height + pad;
      if (y + tooltipHeight > vh - 16) {
        y = rect.y - pad - tooltipHeight;
        actualPlacement = 'top';
      }
      break;
    }
    case 'top': {
      x = rect.x + rect.width / 2 - tooltipWidth / 2;
      y = rect.y - pad - tooltipHeight;
      if (y < 16) {
        y = rect.y + rect.height + pad;
        actualPlacement = 'bottom';
      }
      break;
    }
    case 'right': {
      x = rect.x + rect.width + pad;
      y = rect.y + rect.height / 2 - tooltipHeight / 2;
      if (x + tooltipWidth > vw - 16) {
        x = rect.x - pad - tooltipWidth;
        actualPlacement = 'left';
      }
      break;
    }
    case 'left': {
      x = rect.x - pad - tooltipWidth;
      y = rect.y + rect.height / 2 - tooltipHeight / 2;
      if (x < 16) {
        x = rect.x + rect.width + pad;
        actualPlacement = 'right';
      }
      break;
    }
  }

  x = Math.max(16, Math.min(vw - tooltipWidth - 16, x));
  y = Math.max(16, Math.min(vh - tooltipHeight - 16, y));

  return { x, y, actualPlacement };
}

function TooltipArrow({ placement }: { placement: TooltipPlacement }) {
  const base = 'absolute w-0 h-0';
  const classes: Record<TooltipPlacement, string> = {
    bottom: `${base} -top-[7px] left-1/2 -translate-x-1/2 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-white dark:border-b-zinc-900`,
    top: `${base} -bottom-[7px] left-1/2 -translate-x-1/2 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-white dark:border-t-zinc-900`,
    right: `${base} -left-[7px] top-8 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[8px] border-r-white dark:border-r-zinc-900`,
    left: `${base} -right-[7px] top-8 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[8px] border-l-white dark:border-l-zinc-900`,
  };

  return <div className={classes[placement]} />;
}

function toCompletionPatch(tourId: TourId) {
  return tourId === 'app-navigation'
    ? { appNavigationTourCompleted: true }
    : { workflowBuilderTourCompleted: true };
}

export function SpotlightTour() {
  const isMobile = useIsMobile();
  const activeTour = useTourStore((s) => s.activeTour);
  const currentStep = useTourStore((s) => s.currentStep);
  const nextStep = useTourStore((s) => s.nextStep);
  const prevStep = useTourStore((s) => s.prevStep);
  const dismissTour = useTourStore((s) => s.dismissTour);
  const setTourCompleted = useTourStore((s) => s.setTourCompleted);
  const clearRequestedTour = useTourStore((s) => s.clearRequestedTour);
  const updatePreferences = useUpdateOnboardingPreferences();

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(220);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);

  const persistCompletedTour = useCallback(
    (tourId: TourId) => {
      setTourCompleted(tourId, true);
      clearRequestedTour();
      void updatePreferences.mutateAsync(toCompletionPatch(tourId));
    },
    [clearRequestedTour, setTourCompleted, updatePreferences],
  );

  const handleDismiss = useCallback(() => {
    const dismissedTour = dismissTour();
    if (dismissedTour) {
      persistCompletedTour(dismissedTour);
    }
  }, [dismissTour, persistCompletedTour]);

  const handleComplete = useCallback(() => {
    const completedTour = dismissTour();
    if (completedTour) {
      persistCompletedTour(completedTour);
    }
  }, [dismissTour, persistCompletedTour]);

  useEffect(() => {
    if (isMobile && activeTour) {
      handleDismiss();
    }
  }, [activeTour, handleDismiss, isMobile]);

  const tourDef = activeTour ? tourDefinitions[activeTour] : null;
  const step = tourDef?.steps[currentStep] ?? null;
  const totalSteps = tourDef?.steps.length ?? 0;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  const updateTargetRect = useCallback(() => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    setTargetRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }, [step?.target]);

  useEffect(() => {
    if (!tooltipRef.current) return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setTooltipHeight(entry.contentRect.height);
    });

    obs.observe(tooltipRef.current);
    return () => obs.disconnect();
  }, [activeTour, currentStep]);

  useEffect(() => {
    if (!activeTour || !step) return;

    step.beforeShow?.();

    if (step.target) {
      const scrollEl = document.querySelector(`[data-tour="${step.target}"]`);
      if (scrollEl) {
        scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    const delay = step.beforeShow ? 450 : 100;
    const timer = setTimeout(updateTargetRect, delay);
    const timer2 = step.beforeShow ? setTimeout(updateTargetRect, 700) : null;

    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    if (el) {
      observerRef.current = new ResizeObserver(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateTargetRect);
      });
      observerRef.current.observe(el);
    }

    return () => {
      clearTimeout(timer);
      if (timer2) clearTimeout(timer2);
      cancelAnimationFrame(rafRef.current);
      observerRef.current?.disconnect();
    };
  }, [activeTour, currentStep, step, updateTargetRect]);

  useEffect(() => {
    if (!activeTour) return;

    const handleResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
      updateTargetRect();
    };

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateTargetRect);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [activeTour, updateTargetRect]);

  useEffect(() => {
    if (!activeTour) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          handleDismiss();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          if (isLastStep) handleComplete();
          else nextStep();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          if (!isFirstStep) prevStep();
          break;
        case 'Enter':
          e.preventDefault();
          if (isLastStep) handleComplete();
          else nextStep();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTour, handleComplete, handleDismiss, isFirstStep, isLastStep, nextStep, prevStep]);

  if (!activeTour || !tourDef || !step || isMobile) {
    return null;
  }

  const tooltipWidth = window.innerWidth < 480 ? TOOLTIP_WIDTH_SMALL : TOOLTIP_WIDTH;
  const {
    x: tooltipX,
    y: tooltipY,
    actualPlacement,
  } = calculateTooltipPosition(targetRect, step.placement, tooltipWidth, tooltipHeight);

  const svgPath = buildSpotlightPath(
    viewportSize.w,
    viewportSize.h,
    targetRect,
    SPOTLIGHT_PADDING,
    SPOTLIGHT_RADIUS,
  );

  const handleNext = () => {
    if (isLastStep) handleComplete();
    else nextStep();
  };

  const handlePrev = () => {
    if (!isFirstStep) prevStep();
  };

  return createPortal(
    <AnimatePresence>
      {activeTour && (
        <div
          className="fixed inset-0 z-[10000]"
          role="dialog"
          aria-modal="true"
          aria-label={tourDef.name}
        >
          <svg
            className="fixed inset-0 w-full h-full pointer-events-none"
            style={{ width: viewportSize.w, height: viewportSize.h }}
          >
            <path
              d={svgPath}
              fill="rgba(0, 0, 0, 0.6)"
              fillRule="evenodd"
              style={{ transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          </svg>

          {targetRect && (
            <div
              className="fixed pointer-events-none"
              style={{
                borderRadius: SPOTLIGHT_RADIUS,
                boxShadow:
                  '0 0 0 2px rgba(99, 102, 241, 0.5), 0 0 24px 4px rgba(99, 102, 241, 0.15)',
                transform: `translate(${targetRect.x - SPOTLIGHT_PADDING}px, ${targetRect.y - SPOTLIGHT_PADDING}px)`,
                width: targetRect.width + SPOTLIGHT_PADDING * 2,
                height: targetRect.height + SPOTLIGHT_PADDING * 2,
                transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          )}

          <div
            className="fixed inset-0"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleDismiss();
            }}
          />

          <motion.div
            ref={tooltipRef}
            className="fixed bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-border/50 overflow-hidden"
            style={{ width: tooltipWidth, zIndex: 10001 }}
            key={`step-${currentStep}`}
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{
              opacity: 1,
              scale: 1,
              x: tooltipX,
              y: tooltipY,
            }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 32,
            }}
          >
            <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

            {targetRect && <TooltipArrow placement={actualPlacement} />}

            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  {!step.target && (
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-base font-semibold text-foreground leading-tight">
                      {step.title}
                    </h3>
                    <span className="text-[11px] text-muted-foreground/60">
                      {currentStep + 1} of {totalSteps}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleDismiss}
                  className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  aria-label="Skip tour"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                {step.description}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {tourDef.steps.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => useTourStore.getState().goToStep(i)}
                      className={cn(
                        'rounded-full transition-all duration-300',
                        i === currentStep
                          ? 'w-6 h-2 bg-indigo-500'
                          : i < currentStep
                            ? 'w-2 h-2 bg-indigo-300 dark:bg-indigo-700 hover:bg-indigo-400'
                            : 'w-2 h-2 bg-muted-foreground/20 hover:bg-muted-foreground/40',
                      )}
                      aria-label={`Go to step ${i + 1}`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {!isFirstStep && (
                    <button
                      onClick={handlePrev}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                  )}
                  {isFirstStep && !isLastStep && (
                    <button
                      onClick={handleDismiss}
                      className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm hover:shadow"
                  >
                    {isLastStep ? "Let's Go!" : 'Next'}
                    {!isLastStep && <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[11px] text-muted-foreground/60 text-center">
                  Use arrow keys to navigate, Escape to skip
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
