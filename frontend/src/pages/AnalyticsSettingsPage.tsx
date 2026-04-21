import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BarChart3, Database, Calendar, AlertCircle, Trash2, Info } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useToast } from '@/components/ui/use-toast';
import {
  useAnalyticsSettings,
  useStorageUsage,
  useUpdateAnalyticsSettings,
  usePurgeAnalyticsData,
} from '@/hooks/queries/useAnalyticsSettingsQueries';

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

export function AnalyticsSettingsPage() {
  const roles = useAuthStore((state) => state.roles);
  const canManageSettings = hasAdminRole(roles);
  const isReadOnly = !canManageSettings;
  const { toast } = useToast();

  const { data: settings, isPending: settingsLoading } = useAnalyticsSettings();
  const { data: storageUsage } = useStorageUsage();
  const updateSettings = useUpdateAnalyticsSettings();
  const purgeData = usePurgeAnalyticsData();

  const maxAllowedRetention = settings?.maxRetentionDays ?? 365;

  const [retentionPeriod, setRetentionPeriod] = useState<string | null>(null);
  const [showRetentionConfirm, setShowRetentionConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  // Derive the effective retention from local state or server state
  const savedRetentionPeriod = String(settings?.analyticsRetentionDays ?? 30);
  const effectiveRetentionPeriod = retentionPeriod ?? savedRetentionPeriod;
  const isDirty = effectiveRetentionPeriod !== savedRetentionPeriod;
  const isReducingRetention = parseInt(effectiveRetentionPeriod) < parseInt(savedRetentionPeriod);

  // Filter retention periods based on tier limit
  const availableRetentionPeriods = RETENTION_PERIODS.filter(
    (period) => period.days <= maxAllowedRetention,
  );

  const handleSave = async () => {
    if (isReadOnly || !isDirty) return;

    if (isReducingRetention) {
      setShowRetentionConfirm(true);
      return;
    }

    await performSave();
  };

  const performSave = async () => {
    try {
      await updateSettings.mutateAsync({
        analyticsRetentionDays: parseInt(effectiveRetentionPeriod),
      });
      setRetentionPeriod(null);
      toast({
        title: 'Settings saved',
        description: 'Analytics retention period updated successfully.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Failed to save settings',
        description: err instanceof Error ? err.message : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    }
  };

  const handlePurge = async () => {
    try {
      await purgeData.mutateAsync();
      toast({
        title: 'Data purged',
        description: 'All analytics data has been permanently deleted.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Failed to purge data',
        description: err instanceof Error ? err.message : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    }
  };

  if (settingsLoading) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-4 md:py-8 px-3 md:px-6 max-w-5xl">
          <Skeleton className="h-4 w-64 mb-6" />
          <div className="space-y-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-44 w-full rounded-lg" />
              <Skeleton className="h-44 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-6 max-w-5xl">
        {/* Subtitle — title is in the top bar */}
        <p className="text-sm text-muted-foreground mb-6">
          Configure data retention and storage settings for workflow analytics
        </p>

        {/* Read-only warning */}
        {isReadOnly && (
          <div className="mb-4 rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            Read-only — admin privileges required to modify settings.
          </div>
        )}

        {/* Retention Overview — full-width banner */}
        <div className="rounded-xl border bg-card p-4 md:p-5 mb-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold">Retention Limits</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Maximum retention: {maxAllowedRetention} days
              </p>
            </div>
          </div>
        </div>

        {/* Two-column: Retention + Storage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Data Retention */}
          <div className="rounded-xl border bg-card p-4 md:p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Calendar className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Data Retention</h2>
                <p className="text-xs text-muted-foreground">
                  Auto-delete analytics data after a set period
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="retention-period" className="text-xs font-medium">
                  Retention Period
                </Label>
                <Select
                  value={effectiveRetentionPeriod}
                  onValueChange={setRetentionPeriod}
                  disabled={isReadOnly}
                >
                  <SelectTrigger id="retention-period" className="mt-1.5">
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
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Data older than {effectiveRetentionPeriod} days is automatically deleted.
                </p>
              </div>

              <Button
                onClick={handleSave}
                disabled={isReadOnly || updateSettings.isPending || !isDirty}
                size="sm"
                className="w-full"
              >
                {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </div>

          {/* Storage Usage */}
          <div className="rounded-xl border bg-card p-4 md:p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Database className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Storage Usage</h2>
                <p className="text-xs text-muted-foreground">Analytics storage consumption</p>
              </div>
            </div>

            {storageUsage && storageUsage.analyticsEnabled && storageUsage.documentCount > 0 ? (
              <div className="space-y-3">
                <Progress
                  value={Math.min((storageUsage.usedBytes / (1024 * 1024 * 1024)) * 100, 100)}
                  className="h-2"
                />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {(storageUsage.usedBytes / (1024 * 1024)).toFixed(1)} MB used
                  </span>
                  <span className="font-medium">
                    {storageUsage.documentCount.toLocaleString()} documents
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center">
                <Database className="h-8 w-8 text-muted-foreground/25 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No data collected yet</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Usage appears once workflows send analytics
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Info banner */}
        <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 mb-4 flex items-start gap-2.5">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Analytics data is indexed from workflow executions via the Analytics Sink component.
            Includes security findings, scan results, and other workflow outputs. Query via the API
            or query via ClickHouse.
          </p>
        </div>

        {/* Danger Zone */}
        {canManageSettings && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/[0.02] p-4 md:p-5">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permanently delete all analytics data. This cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs flex-shrink-0"
                onClick={() => setShowPurgeConfirm(true)}
                disabled={purgeData.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1.5" />
                Purge Data
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Retention Reduction Confirmation Dialog */}
      <AlertDialog open={showRetentionConfirm} onOpenChange={setShowRetentionConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reduce data retention?</AlertDialogTitle>
            <AlertDialogDescription>
              Reducing the retention period from {savedRetentionPeriod} days to{' '}
              {effectiveRetentionPeriod} days will permanently delete analytics data older than{' '}
              {effectiveRetentionPeriod} days. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRetentionConfirm(false);
                performSave();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reduce & Delete Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Purge Data Confirmation Dialog */}
      <AlertDialog open={showPurgeConfirm} onOpenChange={setShowPurgeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all analytics data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all collected analytics data including security findings,
              scan results, and workflow outputs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowPurgeConfirm(false);
                handlePurge();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
