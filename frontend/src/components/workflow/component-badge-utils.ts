import { useMemo } from 'react';
import type { ComponentMetadata } from '@/schemas/component';

export type BadgeType = 'official' | 'community' | 'latest' | 'outdated' | 'deprecated';

/**
 * Get badge type from component metadata
 */
export function getBadgeTypeFromComponent(component: ComponentMetadata): BadgeType {
  const isLatest = component.isLatest ?? true;
  if (component.deprecated) return 'deprecated';
  if (!isLatest) return 'outdated';
  if (isLatest) return 'latest';
  return component.author?.type === 'shipsecai' ? 'official' : 'community';
}

/**
 * ComponentBadges - Display all relevant badges for a component
 */
export function useComponentBadges(component: ComponentMetadata) {
  return useMemo(() => {
    const badges: { type: BadgeType; version?: string }[] = [];
    const isLatest = component.isLatest ?? true;

    if (component.author?.type === 'shipsecai') {
      badges.push({ type: 'official' });
    } else if (component.author?.type === 'community') {
      badges.push({ type: 'community' });
    }

    if (component.deprecated) {
      badges.push({ type: 'deprecated' });
    } else if (!isLatest) {
      badges.push({ type: 'outdated' });
    } else if (isLatest) {
      badges.push({ type: 'latest' });
    }

    return badges;
  }, [component]);
}
