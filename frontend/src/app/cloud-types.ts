import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { FeatureKey } from '@/features/feature-flags';

export interface FrontendCloudNavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
  newTab?: boolean;
  requiredFlag?: FeatureKey;
}

export interface FrontendCloudNavGroup {
  label?: string;
  items: FrontendCloudNavItem[];
  requiredFlag?: FeatureKey;
}

export interface OptionalRouteComponents {
  BillingPage: ReactNode;
}

export interface FrontendCloudExtension {
  routeComponents: OptionalRouteComponents | null;
  navigationGroups: FrontendCloudNavGroup[];
  settingsItems: FrontendCloudNavItem[];
}
