import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Users, AlertCircle, AlertTriangle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComponentMetadata } from '@/schemas/component'

type BadgeType = 'official' | 'community' | 'latest' | 'outdated' | 'deprecated'

interface ComponentBadgeProps {
  type: BadgeType
  version?: string
  compact?: boolean
  className?: string
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
export function ComponentBadge({ type, version, compact = false, className }: ComponentBadgeProps) {
  const config = BADGE_CONFIGS[type]
  const Icon = config.icon
  const isOfficial = type === 'official'
  const effectiveCompact = compact || isOfficial
  const showLabel = !(type === 'official' && compact)

  // Customize label for outdated badge with version
  const label = type === 'outdated' && version
    ? `v${version} available`
    : config.label

  return (
    <Badge
      variant={config.variant}
      className={cn(
        showLabel ? 'gap-1' : 'gap-0',
        effectiveCompact && 'py-0 text-[10px] leading-4',
        showLabel ? 'px-2' : 'px-1.5',
        className
      )}
      title={config.label}
      aria-label={config.label}
    >
      <Icon className={cn(effectiveCompact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
      {showLabel && label}
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

interface ComponentMetadataSummaryProps {
  component: ComponentMetadata
  className?: string
  orientation?: 'horizontal' | 'vertical'
  compact?: boolean
  showVersion?: boolean
}

/**
 * Renders badges and version inline so users don't need to open a popover
 */
export function ComponentMetadataSummary({
  component,
  className,
  orientation = 'horizontal',
  compact = false,
  showVersion = true,
}: ComponentMetadataSummaryProps) {
  const badges = useComponentBadges(component)
  const hasVersion = Boolean(showVersion && component.version)

  if (badges.length === 0 && !hasVersion) {
    return null
  }

  const containerClass =
    orientation === 'vertical'
      ? 'flex flex-col gap-1'
      : 'flex items-center gap-1 flex-wrap'

  const versionClass = compact
    ? 'text-[10px] font-medium uppercase tracking-[0.08em]'
    : 'text-xs font-mono'

  return (
    <div className={cn(containerClass, className)}>
      {badges.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap gap-1',
            orientation === 'vertical' ? 'items-start' : 'items-center'
          )}
        >
          {badges.map((badge, index) => (
            <ComponentBadge
              key={index}
              type={badge.type}
              version={badge.version}
              compact={compact}
            />
          ))}
        </div>
      )}
      {hasVersion && (
        <span className={cn('text-muted-foreground opacity-80', versionClass)}>
          v{component.version}
        </span>
      )}
    </div>
  )
}
