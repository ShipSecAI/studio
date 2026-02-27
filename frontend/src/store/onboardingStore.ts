import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      hasCompletedOnboarding: false,
      currentStep: 0,
      setCurrentStep: (step) => set({ currentStep: step }),
      nextStep: () => set({ currentStep: Math.min(5, get().currentStep + 1) }),
      prevStep: () => set({ currentStep: Math.max(0, get().currentStep - 1) }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true, currentStep: 0 }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false, currentStep: 0 }),
    }),
    {
      name: 'shipsec-onboarding',
      partialize: (state) => ({ hasCompletedOnboarding: state.hasCompletedOnboarding }), // Only persist hasCompletedOnboarding, not currentStep
    },
  ),
);
