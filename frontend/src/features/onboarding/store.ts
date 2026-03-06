import { create } from 'zustand';

export type TourId = 'app-navigation' | 'workflow-builder';

interface TourState {
  /** Which tours have been completed */
  completedTours: Record<TourId, boolean>;
  /** Whether server-backed completion state has been loaded */
  serverStateLoaded: boolean;
  /** Currently active tour (null if none) */
  activeTour: TourId | null;
  /** Current step index within the active tour */
  currentStep: number;
  /** Manual replay request coming from command palette or other UI */
  requestedTour: TourId | null;

  startTour: (tourId: TourId) => void;
  requestTour: (tourId: TourId) => void;
  clearRequestedTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  dismissTour: () => TourId | null;
  syncCompletedTours: (completedTours: Record<TourId, boolean>) => void;
  setTourCompleted: (tourId: TourId, completed: boolean) => void;
  /** Check if a tour should auto-start (not yet completed) */
  shouldAutoStart: (tourId: TourId) => boolean;
  /** Reset a specific tour so it can be replayed */
  resetTour: (tourId: TourId) => void;
}

const defaultCompletedTours: Record<TourId, boolean> = {
  'app-navigation': false,
  'workflow-builder': false,
};

export const useTourStore = create<TourState>((set, get) => ({
  completedTours: defaultCompletedTours,
  serverStateLoaded: false,
  activeTour: null,
  currentStep: 0,
  requestedTour: null,

  startTour: (tourId) => {
    set({ activeTour: tourId, currentStep: 0, requestedTour: null });
  },

  requestTour: (tourId) => {
    set({ requestedTour: tourId });
  },

  clearRequestedTour: () => {
    set({ requestedTour: null });
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

  dismissTour: () => {
    const activeTour = get().activeTour;
    set({ activeTour: null, currentStep: 0 });
    return activeTour;
  },

  syncCompletedTours: (completedTours) => {
    set({
      completedTours: {
        'app-navigation': completedTours['app-navigation'] ?? false,
        'workflow-builder': completedTours['workflow-builder'] ?? false,
      },
      serverStateLoaded: true,
    });
  },

  setTourCompleted: (tourId, completed) => {
    set((state) => ({
      completedTours: { ...state.completedTours, [tourId]: completed },
    }));
  },

  shouldAutoStart: (tourId) => {
    const state = get();
    return state.serverStateLoaded && !state.completedTours[tourId] && state.activeTour === null;
  },

  resetTour: (tourId) => {
    set((state) => ({
      completedTours: { ...state.completedTours, [tourId]: false },
    }));
  },
}));
