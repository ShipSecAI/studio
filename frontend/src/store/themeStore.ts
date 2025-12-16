import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  isTransitioning: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  startTransition: () => void
  endTransition: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      isTransitioning: false,
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      toggleTheme: () => {
        const current = get().theme
        const next = current === 'light' ? 'dark' : 'light'
        // If we want to use the transition, we should probably call startTransition from the UI
        // But for backward compatibility, if toggleTheme is called directly, just switch
        set({ theme: next })
        applyTheme(next)
      },
      startTransition: () => set({ isTransitioning: true }),
      endTransition: () => set({ isTransitioning: false }),
    }),
    {
      name: 'shipsec-theme',
      partialize: (state) => ({ theme: state.theme }), // Only persist theme, not isTransitioning
      onRehydrateStorage: () => (state) => {
        // Apply theme when store is rehydrated from localStorage
        // Always reset isTransitioning to false on rehydrate to prevent stuck states
        if (state) {
          state.isTransitioning = false
          applyTheme(state.theme)
        }
      },
    }
  )
)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  
  // Disable transitions during the prompt switch to prevent "jank"
  // where different elements transition at different speeds.
  root.classList.add('theme-switching')
  
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  
  // Force reflow to flush changes while transitions are disabled
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  root.offsetHeight
  
  // Re-enable transitions
  root.classList.remove('theme-switching')
}

// Initialize theme on module load (handles initial page load)
export function initializeTheme() {
  const stored = localStorage.getItem('shipsec-theme')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (parsed?.state?.theme) {
        applyTheme(parsed.state.theme) // No animation on initial load
      }
    } catch {
      // Invalid stored value, use default
    }
  }
}
