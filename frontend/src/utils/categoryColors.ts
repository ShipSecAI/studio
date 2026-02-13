import {
  type ComponentCategory,
  DEFAULT_COMPONENT_CATEGORY,
  getComponentCategoryDescriptor,
  normalizeComponentCategory,
} from '@shipsec/shared';
import { useThemeStore } from '@/store/themeStore';

function resolveCategory(category: string): ComponentCategory {
  return normalizeComponentCategory(category) ?? DEFAULT_COMPONENT_CATEGORY;
}

export function getCategoryTextColorClass(category: string): string {
  return getComponentCategoryDescriptor(resolveCategory(category)).textColorClass;
}

export function getCategorySeparatorColor(category: string, isDarkMode: boolean): string {
  const colors = getComponentCategoryDescriptor(resolveCategory(category)).separatorColor;
  return isDarkMode ? colors.dark : colors.light;
}

export function getCategoryHeaderBackgroundColor(category: string, isDarkMode: boolean): string {
  const colors = getComponentCategoryDescriptor(resolveCategory(category)).headerBackgroundColor;
  return isDarkMode ? colors.dark : colors.light;
}

export function useCategoryColors(category: string) {
  const theme = useThemeStore((state) => state.theme);
  const isDarkMode = theme === 'dark';

  return {
    separatorColor: getCategorySeparatorColor(category, isDarkMode),
    headerBackgroundColor: getCategoryHeaderBackgroundColor(category, isDarkMode),
    textColorClass: getCategoryTextColorClass(category),
  };
}
