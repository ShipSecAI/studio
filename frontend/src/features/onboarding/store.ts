import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TourId = 'app-navigation' | 'workflow-builder';

interface TourState {
  /** Which tours have been completed */
  completedTours: Record<TourId, boolean>;
  /** Currently active tour (null if none) */
  activeTour: TourId | null;
  /** Current step index within the active tour */
  currentStep: number;

  startTour: (tourId: TourId) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  skipTour: () => void;
  completeTour: () => void;
  /** Check if a tour should auto-start (not yet completed) */
  shouldAutoStart: (tourId: TourId) => boolean;
  /** Reset a specific tour so it can be replayed */
  resetTour: (tourId: TourId) => void;
}

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      completedTours: {} as Record<TourId, boolean>,
      activeTour: null,
      currentStep: 0,

      startTour: (tourId) => {
        set({ activeTour: tourId, currentStep: 0 });
      },

      nextStep: () => {
        set((state) => ({ currentStep: state.currentStep + 1 }));
      },

      prevStep: () => {
        set((state) => ({ currentStep: Math.max(0, state.currentStep - 1) }));
      },

      goToStep: (step) => {
        set({ currentStep: step });
      },

      skipTour: () => {
        const { activeTour } = get();
        if (activeTour) {
          set((state) => ({
            activeTour: null,
            currentStep: 0,
            completedTours: { ...state.completedTours, [activeTour]: true },
          }));
        }
      },

      completeTour: () => {
        const { activeTour } = get();
        if (activeTour) {
          set((state) => ({
            activeTour: null,
            currentStep: 0,
            completedTours: { ...state.completedTours, [activeTour]: true },
          }));
        }
      },

      shouldAutoStart: (tourId) => {
        return !get().completedTours[tourId] && get().activeTour === null;
      },

      resetTour: (tourId) => {
        set((state) => ({
          completedTours: { ...state.completedTours, [tourId]: false },
        }));
      },
    }),
    {
      name: 'onboarding-tours',
      partialize: (state) => ({
        completedTours: state.completedTours,
      }),
    },
  ),
);
