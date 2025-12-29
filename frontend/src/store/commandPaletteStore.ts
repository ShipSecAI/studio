import { create } from 'zustand'

interface CommandPaletteStore {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

/**
 * Command Palette Store
 * Manages the open/close state of the command palette
 */
export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  isOpen: false,

  open: () => {
    set({ isOpen: true })
  },

  close: () => {
    set({ isOpen: false })
  },

  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }))
  },
}))
