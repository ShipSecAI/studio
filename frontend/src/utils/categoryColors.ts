import { useThemeStore } from '@/store/themeStore'

// Component category type
export type ComponentCategory = 'input' | 'transform' | 'ai' | 'security' | 'it_ops' | 'output'

/**
 * Category-based separator colors (2 shades lighter than normal)
 * Only used for the header separator line
 */
export const CATEGORY_SEPARATOR_COLORS: Record<ComponentCategory, { light: string; dark: string }> = {
  input: {
    light: 'rgb(147 197 253)', // blue-300 (2 shades lighter than blue-500)
    dark: 'rgb(147 197 253)', // blue-300 (2 shades lighter than blue-400)
  },
  transform: {
    light: 'rgb(253 186 116)', // orange-300 (2 shades lighter than orange-500)
    dark: 'rgb(253 186 116)', // orange-300 (2 shades lighter than orange-400)
  },
  ai: {
    light: 'rgb(196 181 253)', // violet-300 (2 shades lighter than violet-500)
    dark: 'rgb(196 181 253)', // violet-300 (2 shades lighter than violet-400)
  },
  security: {
    light: 'rgb(252 165 165)', // red-300 (2 shades lighter than red-500)
    dark: 'rgb(252 165 165)', // red-300 (2 shades lighter than red-400)
  },
  it_ops: {
    light: 'rgb(103 232 249)', // cyan-300 (2 shades lighter than cyan-500)
    dark: 'rgb(103 232 249)', // cyan-300 (2 shades lighter than cyan-400)
  },
  output: {
    light: 'rgb(134 239 172)', // green-300 (2 shades lighter than green-500)
    dark: 'rgb(134 239 172)', // green-300 (2 shades lighter than green-400)
  },
}

/**
 * Category-based header background colors (very light shades)
 * Used for node headers and sidebar accordions
 */
export const CATEGORY_HEADER_BG_COLORS: Record<ComponentCategory, { light: string; dark: string }> = {
  input: {
    light: 'rgb(250 252 255)', // custom blue-25
    dark: 'rgb(23 37 84 / 0.15)', // blue-950/15
  },
  transform: {
    light: 'rgb(255 251 250)', // custom orange-25
    dark: 'rgb(69 10 10 / 0.15)', // orange-950/15
  },
  ai: {
    light: 'rgb(253 250 255)', // custom violet-25
    dark: 'rgb(36 25 50 / 0.15)', // violet-950/15
  },
  security: {
    light: 'rgb(255 250 250)', // custom red-25
    dark: 'rgb(69 10 10 / 0.15)', // red-950/15
  },
  it_ops: {
    light: 'rgb(250 254 255)', // custom cyan-25
    dark: 'rgb(22 78 99 / 0.15)', // cyan-950/15
  },
  output: {
    light: 'rgb(250 255 250)', // custom green-25
    dark: 'rgb(20 83 45 / 0.15)', // green-950/15
  },
}

/**
 * Get category separator color (for header separator lines)
 * @param category - Component category
 * @param isDarkMode - Whether dark mode is active
 * @returns RGB color string or undefined
 */
export function getCategorySeparatorColor(
  category: ComponentCategory,
  isDarkMode: boolean
): string | undefined {
  const colors = CATEGORY_SEPARATOR_COLORS[category]
  return isDarkMode ? colors.dark : colors.light
}

/**
 * Get category header background color
 * @param category - Component category
 * @param isDarkMode - Whether dark mode is active
 * @returns RGB color string or undefined
 */
export function getCategoryHeaderBackgroundColor(
  category: ComponentCategory,
  isDarkMode: boolean
): string | undefined {
  const colors = CATEGORY_HEADER_BG_COLORS[category]
  return isDarkMode ? colors.dark : colors.light
}

/**
 * Hook to get category colors based on current theme
 * @param category - Component category
 * @returns Object with separatorColor and headerBackgroundColor
 */
export function useCategoryColors(category: ComponentCategory) {
  const theme = useThemeStore((state) => state.theme)
  const isDarkMode = theme === 'dark'
  
  return {
    separatorColor: getCategorySeparatorColor(category, isDarkMode),
    headerBackgroundColor: getCategoryHeaderBackgroundColor(category, isDarkMode),
  }
}

