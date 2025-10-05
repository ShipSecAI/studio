import { Badge } from '@/components/ui/badge'
import { CheckCircle, Users, AlertCircle, AlertTriangle } from 'lucide-react'
import type { ComponentMetadata } from '@/schemas/component'

type BadgeType = 'official' | 'community' | 'latest' | 'outdated' | 'deprecated'

interface ComponentBadgeProps {
  type: BadgeType
  version?: string
}

interface BadgeConfig {
  label: string
  variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
  icon: React.ComponentType<{ className?: string }>
}

const BADGE_CONFIGS: Record<BadgeType, BadgeConfig> = {
  official: {
    label: 'ShipSecAI',
    variant: 'default',
    icon: CheckCircle,
  },
  community: {
    label: 'Community',
    variant: 'secondary',
    icon: Users,
  },
  latest: {
    label: 'Latest',
    variant: 'success',
    icon: CheckCircle,
  },
  outdated: {
    label: 'Update available',
    variant: 'warning',
    icon: AlertCircle,
  },
  deprecated: {
    label: 'Deprecated',
    variant: 'destructive',
    icon: AlertTriangle,
  },
}

/**
 * ComponentBadge - Display badges for component metadata
 *
 * @example
 * <ComponentBadge type="official" />
 * <ComponentBadge type="latest" />
 * <ComponentBadge type="outdated" version="1.1.0" />
 */
export function ComponentBadge({ type, version }: ComponentBadgeProps) {
  const config = BADGE_CONFIGS[type]
  const Icon = config.icon

  // Customize label for outdated badge with version
  const label = type === 'outdated' && version
    ? `v${version} available`
    : config.label

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  )
}

/**
 * Get badge type from component metadata
 */
export function getBadgeTypeFromComponent(
  component: ComponentMetadata
): BadgeType {
  if (component.deprecated) return 'deprecated'
  if (!component.isLatest) return 'outdated'
  if (component.isLatest) return 'latest'
  return component.author.type === 'shipsecai' ? 'official' : 'community'
}

/**
 * ComponentBadges - Display all relevant badges for a component
 */
export function ComponentBadges({ component }: { component: ComponentMetadata }) {
  const badges: Array<{ type: BadgeType; version?: string }> = []

  // Author badge (official or community)
  if (component.author.type === 'shipsecai') {
    badges.push({ type: 'official' })
  } else {
    badges.push({ type: 'community' })
  }

  // Status badges
  if (component.deprecated) {
    badges.push({ type: 'deprecated' })
  } else if (!component.isLatest) {
    badges.push({ type: 'outdated' })
  } else if (component.isLatest) {
    badges.push({ type: 'latest' })
  }

  return (
    <div className="flex items-center gap-1">
      {badges.map((badge, index) => (
        <ComponentBadge key={index} type={badge.type} version={badge.version} />
      ))}
    </div>
  )
}
