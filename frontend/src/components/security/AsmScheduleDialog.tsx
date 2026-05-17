import { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe, X } from 'lucide-react';
import { useGitHubStore } from '@/store/githubStore';
import { useCreateSchedule, useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useWorkflow } from '@/hooks/queries/useWorkflowQueries';
import { useToast } from '@/components/ui/use-toast';
import { ASM_SCHEDULE_SCANS } from './constants';
import {
  ScheduleCadenceAndNameFields,
  ScheduleDialogActions,
  ScheduleDialogTitle,
  ScheduleDuplicateWarning,
  ScheduleScanTypePicker,
} from './ScheduleDialogShared';
import { getLocalTimezone } from './schedule-utils';

const SUBFINDER_COMPONENT_ID = 'shipsec.subfinder.run';

interface AsmScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  preSelectedScanId?: string;
  onScheduled?: () => void;
}

export function AsmScheduleDialog({
  open,
  onClose,
  onBack,
  preSelectedScanId,
  onScheduled,
}: AsmScheduleDialogProps) {
  const { toast } = useToast();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const createSchedule = useCreateSchedule();
  const { data: existingSchedules = [] } = useSchedules();

  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [selectedScan, setSelectedScan] = useState<string | null>(null);
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
      setDomains([]);
      setDomainInput('');
      setSelectedScan(preSelectedScanId ?? null);
      setCronExpression('0 2 * * *');
      setHumanLabel('Daily at 2 AM');
      setScheduleName('');
      setNameEdited(false);
    }
  }, [open, preSelectedScanId]);

  const resolvedScans = useMemo(() => {
    return ASM_SCHEDULE_SCANS.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [systemWorkflows]);

  const selectedScanDef = resolvedScans.find((s) => s.id === selectedScan);

  // Fetch the workflow to discover the subfinder node
  const { data: workflowDetail } = useWorkflow(selectedScanDef?.workflowId);

  const subfinderNodeId = useMemo(() => {
    if (!workflowDetail?.graph?.nodes) return null;
    const node = workflowDetail.graph.nodes.find((n: any) => n.type === SUBFINDER_COMPONENT_ID);
    return node?.id ?? null;
  }, [workflowDetail]);

  // Auto-generate schedule name
  useEffect(() => {
    if (nameEdited) return;
    const target = domains.length > 0 ? domains.join(', ') : 'Domains';
    const scanName = selectedScanDef?.name || 'Recon';
    const cadence = humanLabel.split(' at ')[0] || 'Custom';
    setScheduleName(`${target} — ${scanName} (${cadence})`);
  }, [domains, selectedScanDef, humanLabel, nameEdited]);

  const addDomain = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !domains.includes(trimmed)) {
      setDomains((prev) => [...prev, trimmed]);
    }
    setDomainInput('');
  };

  const removeDomain = (domain: string) => {
    setDomains((prev) => prev.filter((d) => d !== domain));
  };

  const handleDomainKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDomain(domainInput);
    }
  };

  // Duplicate detection
  const hasDuplicate = useMemo(() => {
    if (!selectedScanDef || domains.length === 0) return false;
    return existingSchedules.some(
      (s: any) =>
        s.status !== 'paused' &&
        s.workflowId === selectedScanDef.workflowId &&
        JSON.stringify(s.inputPayload?.runtimeInputs?.domains?.sort()) ===
          JSON.stringify([...domains].sort()),
    );
  }, [existingSchedules, selectedScanDef, domains]);

  const isValid =
    domains.length > 0 &&
    !!selectedScanDef &&
    !!cronExpression.trim() &&
    scheduleName.trim().length > 0;

  const handleSubmit = async () => {
    if (createSchedule.isPending) return;
    if (!selectedScanDef) return;

    const timezone = getLocalTimezone();
    const runtimeInputs: Record<string, unknown> = {
      domains,
    };

    const nodeOverrides: Record<string, any> = {};
    if (subfinderNodeId) {
      nodeOverrides[subfinderNodeId] = {
        params: {},
        inputOverrides: {
          domains,
        },
      };
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
          nodeOverrides,
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
      const status =
        err !== null &&
        typeof err === 'object' &&
        'response' in err &&
        err.response !== null &&
        typeof err.response === 'object' &&
        'status' in err.response
          ? (err.response as { status: unknown }).status
          : undefined;
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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <ScheduleDialogTitle onBack={onBack}>Schedule Attack Surface Scan</ScheduleDialogTitle>
          </DialogTitle>
          <DialogDescription>
            {domains.length > 0
              ? `${domains.length} domain${domains.length === 1 ? '' : 's'} targeted`
              : 'Enter target domains for recon'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Scan type (only show if not pre-selected) */}
          {!preSelectedScanId && resolvedScans.length > 1 && (
            <ScheduleScanTypePicker
              scans={resolvedScans}
              selectedScan={selectedScan}
              onSelect={setSelectedScan}
            />
          )}

          {/* Domain input */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Target domains</Label>
            <Input
              placeholder="e.g. example.com (press Enter to add)"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={handleDomainKeyDown}
              onBlur={() => domainInput.trim() && addDomain(domainInput)}
              className="text-sm"
            />
            {domains.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {domains.map((domain) => (
                  <span
                    key={domain}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
                  >
                    <Globe className="h-3 w-3" />
                    {domain}
                    <button
                      type="button"
                      onClick={() => removeDomain(domain)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <ScheduleCadenceAndNameFields
            cronExpression={cronExpression}
            humanLabel={humanLabel}
            scheduleName={scheduleName}
            onCadenceChange={(cron, label) => {
              setCronExpression(cron);
              setHumanLabel(label);
            }}
            onScheduleNameChange={(name) => {
              setScheduleName(name);
              setNameEdited(true);
            }}
          />

          {/* Duplicate warning */}
          {hasDuplicate && (
            <ScheduleDuplicateWarning>
              A schedule already exists for these domains.
            </ScheduleDuplicateWarning>
          )}

          <ScheduleDialogActions
            onCancel={onClose}
            onSubmit={handleSubmit}
            isPending={createSchedule.isPending}
            isValid={isValid}
            hasDuplicate={hasDuplicate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
