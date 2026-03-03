import { create } from 'zustand';

interface OnboardingState {
  // Session-only step tracking (not persisted)
  currentStep: number;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetSteps: () => void;

  // Workflow Builder tour step tracking (not persisted)
  builderTourStep: number;
  setBuilderTourStep: (step: number) => void;
  resetBuilderTourStep: () => void;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  currentStep: 0,
  setCurrentStep: (step) => set({ currentStep: step }),
  nextStep: () => set({ currentStep: Math.min(5, get().currentStep + 1) }),
  prevStep: () => set({ currentStep: Math.max(0, get().currentStep - 1) }),
  resetSteps: () => set({ currentStep: 0 }),

  builderTourStep: 0,
  setBuilderTourStep: (step) => set({ builderTourStep: step }),
  resetBuilderTourStep: () => set({ builderTourStep: 0 }),
}));
