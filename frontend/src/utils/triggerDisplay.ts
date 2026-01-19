import type { ExecutionTriggerType } from '@shipsec/shared';

interface TriggerMeta {
  icon: string;
  variant: 'default' | 'secondary' | 'outline';
  fallbackLabel: string;
}

const TRIGGER_META: Record<ExecutionTriggerType, TriggerMeta> = {
  manual: {
    icon: '👤',
    variant: 'secondary',
    fallbackLabel: 'Manual run',
  },
  schedule: {
    icon: '🕐',
    variant: 'outline',
    fallbackLabel: 'Scheduled run',
  },
  api: {
    icon: '🌐',
    variant: 'outline',
    fallbackLabel: 'API trigger',
  },
  webhook: {
    icon: '🔗',
    variant: 'default',
    fallbackLabel: 'Webhook trigger',
  },
};

export interface TriggerDisplay {
  icon: string;
  label: string;
  variant: TriggerMeta['variant'];
}

export const getTriggerDisplay = (
  triggerType?: ExecutionTriggerType | null,
  label?: string | null,
): TriggerDisplay => {
  const meta = (triggerType && TRIGGER_META[triggerType]) ?? TRIGGER_META.manual;
  const cleanLabel = label?.trim();
  return {
    icon: meta.icon,
    variant: meta.variant,
    label: cleanLabel && cleanLabel.length > 0 ? cleanLabel : meta.fallbackLabel,
  };
};
