import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Database, Calendar, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';

// Retention period options in days
const RETENTION_PERIODS = [
  { value: '7', label: '7 days', days: 7 },
  { value: '14', label: '14 days', days: 14 },
  { value: '30', label: '30 days', days: 30 },
  { value: '60', label: '60 days', days: 60 },
  { value: '90', label: '90 days', days: 90 },
  { value: '180', label: '180 days (6 months)', days: 180 },
  { value: '365', label: '365 days (1 year)', days: 365 },
];

// Subscription tier limits
const TIER_LIMITS = {
  free: { name: 'Free', maxRetentionDays: 30 },
  pro: { name: 'Pro', maxRetentionDays: 90 },
  enterprise: { name: 'Enterprise', maxRetentionDays: 365 },
};

type SubscriptionTier = keyof typeof TIER_LIMITS;

export function AnalyticsSettingsPage() {
  const roles = useAuthStore((state) => state.roles);
  const canManageSettings = hasAdminRole(roles);
  const isReadOnly = !canManageSettings;

  // Mock data - will be replaced with actual API calls in US-013
  const [currentTier] = useState<SubscriptionTier>('free');
  const [retentionPeriod, setRetentionPeriod] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [storageUsage] = useState<{ used: string; total: string } | null>(null);

  const tierInfo = TIER_LIMITS[currentTier];
  const maxAllowedRetention = tierInfo.maxRetentionDays;

  // Filter retention periods based on tier limit
  const availableRetentionPeriods = RETENTION_PERIODS.filter(
    (period) => period.days <= maxAllowedRetention,
  );

  useEffect(() => {
    // TODO: US-013 will implement API call to fetch current settings
    // fetchSettings().catch(console.error);
  }, []);

  const handleSave = async () => {
    if (isReadOnly) return;

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      // TODO: US-013 will implement API call to save settings
      // await api.analytics.updateSettings({ retentionDays: parseInt(retentionPeriod) });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));

      setSuccessMessage('Analytics settings updated successfully');

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update analytics settings');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 md:mb-8">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Analytics Settings</h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              Configure data retention and storage settings for workflow analytics
            </p>
          </div>
        </div>

        {/* Read-only warning */}
        {isReadOnly && (
          <div className="mb-4 md:mb-6 rounded-md bg-amber-500/10 p-3 md:p-4 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs md:text-sm text-amber-600 dark:text-amber-400 font-medium">
                  Read-Only Access
                </p>
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">
                  You need admin privileges to modify analytics settings.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 md:mb-6 rounded-md bg-destructive/10 p-3 md:p-4 text-xs md:text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 md:mb-6 rounded-md bg-green-500/10 p-3 md:p-4 text-xs md:text-sm text-green-600 dark:text-green-400">
            {successMessage}
          </div>
        )}

        {/* Settings Cards */}
        <div className="space-y-4 md:space-y-6">
          {/* Subscription Tier Card */}
          <div className="border rounded-md bg-card p-4 md:p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-base md:text-lg font-semibold">Subscription Tier</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Your current subscription tier and analytics limits
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs md:text-sm">
                    {tierInfo.name}
                  </Badge>
                  <span className="text-xs md:text-sm text-muted-foreground">
                    Maximum retention: {maxAllowedRetention} days
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Data Retention Card */}
          <div className="border rounded-md bg-card p-4 md:p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-base md:text-lg font-semibold">Data Retention Period</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  How long to keep analytics data before automatic deletion
                </p>

                <div className="mt-4 max-w-sm">
                  <Label htmlFor="retention-period" className="text-xs md:text-sm">
                    Retention Period
                  </Label>
                  <Select
                    value={retentionPeriod}
                    onValueChange={setRetentionPeriod}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger id="retention-period" className="mt-2">
                      <SelectValue placeholder="Select retention period" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRetentionPeriods.map((period) => (
                        <SelectItem key={period.value} value={period.value}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-2">
                    Analytics data older than {retentionPeriod} days will be automatically deleted.
                  </p>
                </div>

                <div className="mt-4">
                  <Button
                    onClick={handleSave}
                    disabled={isReadOnly || isSubmitting}
                    className="text-xs md:text-sm"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Settings'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Storage Usage Card */}
          <div className="border rounded-md bg-card p-4 md:p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-base md:text-lg font-semibold">Storage Usage</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Current storage consumption for analytics data
                </p>

                <div className="mt-4">
                  {storageUsage ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs md:text-sm">
                        <span className="text-muted-foreground">Used</span>
                        <span className="font-medium">{storageUsage.used}</span>
                      </div>
                      <div className="flex justify-between text-xs md:text-sm">
                        <span className="text-muted-foreground">Total Available</span>
                        <span className="font-medium">{storageUsage.total}</span>
                      </div>
                      {/* Progress bar could be added here */}
                    </div>
                  ) : (
                    <div className="text-xs md:text-sm text-muted-foreground">
                      Storage usage information will be available once analytics data is collected.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 rounded-md bg-muted/50 p-4 md:p-5 border">
          <h3 className="text-sm md:text-base font-medium mb-2">About Analytics Data</h3>
          <ul className="text-xs md:text-sm text-muted-foreground space-y-1.5">
            <li>
              • Analytics data is indexed from workflow executions using the Analytics Sink
              component
            </li>
            <li>• Data includes security findings, scan results, and other workflow outputs</li>
            <li>• You can query this data via the API or view it in OpenSearch Dashboards</li>
            <li>• Retention settings apply organization-wide and cannot exceed your tier limit</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
