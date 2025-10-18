import type { ComponentType } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Info, Shield, Users } from 'lucide-react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ComponentMetadata } from '@/schemas/component'

type BadgeType = 'official' | 'community' | 'latest' | 'outdated' | 'deprecated'

interface ComponentBadgeProps {
  type: BadgeType
  version?: string
}

interface BadgeConfig {
  label: string
  variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
  icon: ComponentType<{ className?: string }>
}

const BADGE_CONFIGS: Record<BadgeType, BadgeConfig> = {
  official: {
    label: 'ShipSecAI',
    variant: 'default',
    icon: Shield,
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
  const isLatest = component.isLatest ?? true
  if (component.deprecated) return 'deprecated'
  if (!isLatest) return 'outdated'
  if (isLatest) return 'latest'
  return component.author?.type === 'shipsecai' ? 'official' : 'community'
}

/**
 * ComponentBadges - Display all relevant badges for a component
 */
export function useComponentBadges(component: ComponentMetadata) {
  return useMemo(() => {
    const badges: Array<{ type: BadgeType; version?: string }> = []
    const isLatest = component.isLatest ?? true

    if (component.author?.type === 'shipsecai') {
      badges.push({ type: 'official' })
    } else if (component.author?.type === 'community') {
      badges.push({ type: 'community' })
    }

    if (component.deprecated) {
      badges.push({ type: 'deprecated' })
    } else if (!isLatest) {
      badges.push({ type: 'outdated' })
    } else if (isLatest) {
      badges.push({ type: 'latest' })
    }

    return badges
  }, [component])
}

export function ComponentBadges({ component }: { component: ComponentMetadata }) {
  const badges = useComponentBadges(component)

  if (badges.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      {badges.map((badge, index) => (
        <ComponentBadge key={index} type={badge.type} version={badge.version} />
      ))}
    </div>
  )
}

interface ComponentInfoButtonProps {
  component: ComponentMetadata
  buttonClassName?: string
  align?: 'start' | 'center' | 'end'
}

export function ComponentInfoButton({
  component,
  buttonClassName,
  align = 'center',
}: ComponentInfoButtonProps) {
  const badges = useComponentBadges(component)

  if (badges.length === 0) {
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 p-0 text-muted-foreground hover:text-foreground', buttonClassName)}
          title="Component metadata"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Component Metadata
        </div>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((badge, index) => (
            <ComponentBadge key={index} type={badge.type} version={badge.version} />
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Version <span className="font-mono">v{component.version}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
