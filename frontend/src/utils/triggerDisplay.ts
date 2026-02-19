import type { ExecutionTriggerType } from '@shipsec/shared';
import type { LucideIcon } from 'lucide-react';
import { User, Clock, Globe, Webhook } from 'lucide-react';

interface TriggerMeta {
  icon: LucideIcon;
  variant: 'default' | 'secondary' | 'outline';
  fallbackLabel: string;
}

const TRIGGER_META: Record<ExecutionTriggerType, TriggerMeta> = {
  manual: {
    icon: User,
    variant: 'secondary',
    fallbackLabel: 'Manual run',
  },
  schedule: {
    icon: Clock,
    variant: 'outline',
    fallbackLabel: 'Scheduled run',
  },
  api: {
    icon: Globe,
    variant: 'outline',
    fallbackLabel: 'API trigger',
  },
  webhook: {
    icon: Webhook,
    variant: 'default',
    fallbackLabel: 'Webhook trigger',
  },
};

export interface TriggerDisplay {
  icon: LucideIcon;
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
