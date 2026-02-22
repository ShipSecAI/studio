import { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowLeft, Cloud, Loader2, Search } from 'lucide-react';
import { useGitHubStore } from '@/store/githubStore';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { useCreateSchedule, useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useToast } from '@/components/ui/use-toast';
import { CadencePicker } from '@/components/schedules/CadencePicker';

interface AwsConnection {
  id: string;
  displayName?: string;
  provider: string;
  config?: Record<string, unknown>;
  status?: string;
}

const CLOUD_QUICK_SCANS = [
  {
    slug: 'cloud-security-scan',
    templateSlug: 'sys-cloud-security-scan',
    name: 'Misconfiguration Scan',
    description: 'Prowler — CIS, GDPR, HIPAA benchmarks',
  },
  {
    slug: 'container-image-scan',
    templateSlug: 'sys-container-image-scan',
    name: 'Container Image Scan',
    description: 'Trivy — ECR image vulnerability scan',
  },
];

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

interface CloudScanScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  connection: AwsConnection | null;
  preSelectedScanSlug?: string;
  onScheduled?: () => void;
}

export function CloudScanScheduleDialog({
  open,
  onClose,
  onBack,
  connection: preSelectedConnection,
  preSelectedScanSlug,
  onScheduled,
}: CloudScanScheduleDialogProps) {
  const { toast } = useToast();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const { data: orgConnections = [], isLoading: connectionsLoading } = useIntegrationConnections();
  const createSchedule = useCreateSchedule();
  const { data: existingSchedules = [] } = useSchedules();

  const awsConnections = useMemo(
    () =>
      orgConnections.filter((c: { provider: string }) => c.provider === 'aws') as AwsConnection[],
    [orgConnections],
  );

  const [selectedConnection, setSelectedConnection] = useState<AwsConnection | null>(
    preSelectedConnection,
  );
  const [connectionSearch, setConnectionSearch] = useState('');
  const [selectedScan, setSelectedScan] = useState<string | null>(null);
  const [imageRef, setImageRef] = useState('');
  const [cronExpression, setCronExpression] = useState('0 2 * * *');
  const [humanLabel, setHumanLabel] = useState('Daily at 2 AM');
  const [scheduleName, setScheduleName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);

  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedConnection(preSelectedConnection);
      setConnectionSearch('');
      setSelectedScan(preSelectedScanSlug ?? null);
      setImageRef('');
      setCronExpression('0 2 * * *');
      setHumanLabel('Daily at 2 AM');
      setScheduleName('');
      setNameEdited(false);
    }
  }, [open, preSelectedConnection, preSelectedScanSlug]);

  const filteredConnections = useMemo(() => {
    if (!connectionSearch.trim()) return awsConnections;
    const q = connectionSearch.toLowerCase();
    return awsConnections.filter(
      (c) =>
        (c.displayName || '').toLowerCase().includes(q) ||
        ((c.config as Record<string, string>)?.accountId || '').includes(q),
    );
  }, [awsConnections, connectionSearch]);

  const resolvedScans = useMemo(() => {
    return CLOUD_QUICK_SCANS.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [systemWorkflows]);

  const selectedScanDef = resolvedScans.find((s) => s.slug === selectedScan);
  const isContainerScan = selectedScan === 'container-image-scan';

  // Auto-generate schedule name
  useEffect(() => {
    if (nameEdited) return;
    const target = selectedConnection?.displayName || 'Cloud Account';
    const scanName = selectedScanDef?.name || 'Scan';
    const cadence = humanLabel.split(' at ')[0] || 'Custom';
    setScheduleName(`${target} — ${scanName} (${cadence})`);
  }, [selectedConnection, selectedScanDef, humanLabel, nameEdited]);

  // Duplicate detection
  const hasDuplicate = useMemo(() => {
    if (!selectedScanDef || !selectedConnection) return false;
    return existingSchedules.some(
      (s: any) =>
        s.status !== 'paused' &&
        s.workflowId === selectedScanDef.workflowId &&
        s.inputPayload?.runtimeInputs?.connectionId === selectedConnection.id,
    );
  }, [existingSchedules, selectedScanDef, selectedConnection]);

  const isValid =
    !!selectedConnection &&
    !!selectedScanDef &&
    !!cronExpression.trim() &&
    scheduleName.trim().length > 0 &&
    (!isContainerScan || imageRef.trim().length > 0);

  const handleSubmit = async () => {
    if (createSchedule.isPending) return;
    if (!selectedScanDef || !selectedConnection) return;

    const timezone = getLocalTimezone();
    const runtimeInputs: Record<string, unknown> = { connectionId: selectedConnection.id };
    if (isContainerScan && imageRef.trim()) {
      runtimeInputs.imageRef = imageRef.trim();
    }

    try {
      await createSchedule.mutateAsync({
        workflowId: selectedScanDef.workflowId,
        name: scheduleName.trim(),
        cronExpression: cronExpression.trim(),
        timezone,
        humanLabel: humanLabel || undefined,
        overlapPolicy: 'skip',
        catchupWindowSeconds: 3600,
        inputPayload: {
          runtimeInputs,
          nodeOverrides: {},
        },
      });
      toast({
        title: 'Scan scheduled',
        description: (
          <span>
            Cadence: {humanLabel || cronExpression} ({timezone}).{' '}
            <a href="/schedules" className="underline font-medium">
              View on Schedules page
            </a>
          </span>
        ),
      });
      onScheduled?.();
      onClose();
    } catch (err) {
      const status = (err as any)?.response?.status;
      toast({
        title: status === 409 ? 'Schedule already exists' : 'Failed to create schedule',
        description:
          status === 409
            ? 'A schedule already exists for this target.'
            : err instanceof Error
              ? err.message
              : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const showConnectionPicker = !selectedConnection;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center mr-2 text-muted-foreground hover:text-foreground transition-colors align-middle"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            Schedule Cloud Scan
          </DialogTitle>
          <DialogDescription>
            {selectedConnection
              ? selectedConnection.displayName || 'Cloud Account'
              : 'Select a cloud account'}
          </DialogDescription>
        </DialogHeader>

        {showConnectionPicker ? (
          /* Step 1: Connection picker */
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={connectionSearch}
                onChange={(e) => setConnectionSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {connectionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))
              ) : filteredConnections.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {awsConnections.length === 0
                    ? 'No cloud accounts connected. Connect one first.'
                    : 'No matching accounts found'}
                </p>
              ) : (
                filteredConnections.map((conn) => {
                  const accountId = (conn.config as Record<string, string>)?.accountId;
                  const region = (conn.config as Record<string, string>)?.region;
                  return (
                    <button
                      key={conn.id}
                      onClick={() => setSelectedConnection(conn)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                    >
                      <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {conn.displayName || 'AWS Account'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[accountId, region].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Step 2: Configure */
          <div className="space-y-4 py-2">
            {/* Scan type */}
            {!preSelectedScanSlug && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Scan type</Label>
                {resolvedScans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Some scan types are unavailable for your organization. Contact your admin.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {resolvedScans.map((scan) => (
                      <button
                        key={scan.slug}
                        type="button"
                        onClick={() => setSelectedScan(scan.slug)}
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                          selectedScan === scan.slug
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="font-medium">{scan.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {scan.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Image ref for container scans */}
            {isContainerScan && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Image reference</Label>
                <Input
                  placeholder="e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/my-app:latest"
                  value={imageRef}
                  onChange={(e) => setImageRef(e.target.value)}
                  className="text-sm"
                />
              </div>
            )}

            {/* Cadence */}
            <CadencePicker
              cronExpression={cronExpression}
              humanLabel={humanLabel}
              onChange={(cron, label) => {
                setCronExpression(cron);
                setHumanLabel(label);
              }}
            />

            {/* Schedule name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Schedule name</Label>
              <Input
                value={scheduleName}
                onChange={(e) => {
                  setScheduleName(e.target.value);
                  setNameEdited(true);
                }}
                className="text-sm"
              />
            </div>

            {/* Duplicate warning */}
            {hasDuplicate && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <span className="text-yellow-800 dark:text-yellow-200">
                  A schedule already exists for this target.
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!isValid || createSchedule.isPending}
                onClick={handleSubmit}
              >
                {createSchedule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {hasDuplicate ? 'Create anyway' : 'Create schedule'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
