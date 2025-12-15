import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      toggleTheme: () => {
        const newTheme = get().theme === 'light' ? 'dark' : 'light'
        set({ theme: newTheme })
        applyTheme(newTheme)
      },
    }),
    {
      name: 'shipsec-theme',
      onRehydrateStorage: () => (state) => {
        // Apply theme when store is rehydrated from localStorage (no animation)
        if (state) {
          applyTheme(state.theme, false)
        }
      },
    }
  )
)

// Track if animation is in progress to prevent rapid toggling issues
let isAnimating = false

function applyTheme(theme: Theme, animate = true) {
  const root = document.documentElement
  
  // Skip animation on initial load or if already animating
  if (!animate || isAnimating) {
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    return
  }
  
  isAnimating = true
  
  // Create the sweep overlay
  const overlay = document.createElement('div')
  overlay.className = 'theme-sweep-overlay'
  
  // Set the overlay color based on the TARGET theme
  if (theme === 'dark') {
    overlay.style.backgroundColor = 'hsl(0 0% 11%)' // Dark background
  } else {
    overlay.style.backgroundColor = 'hsl(0 0% 100%)' // Light background
  }
  
  document.body.appendChild(overlay)
  
  // Trigger the animation
  requestAnimationFrame(() => {
    overlay.classList.add('animate')
    
    // Switch the actual theme when the overlay covers the screen (midpoint)
    setTimeout(() => {
      // Disable transitions during the actual theme switch
      root.classList.add('theme-switching')
      
      if (theme === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
      
      // Force reflow
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      root.offsetHeight
      
      root.classList.remove('theme-switching')
    }, 250) // Switch at midpoint of 500ms animation
    
    // Remove overlay after animation completes
    setTimeout(() => {
      overlay.remove()
      isAnimating = false
    }, 500)
  })
}

// Initialize theme on module load (handles initial page load)
export function initializeTheme() {
  const stored = localStorage.getItem('shipsec-theme')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (parsed?.state?.theme) {
        applyTheme(parsed.state.theme, false) // No animation on initial load
      }
    } catch {
      // Invalid stored value, use default
    }
  }
}
