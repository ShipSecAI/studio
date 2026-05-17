import { useMemo, useState } from 'react';
import {
  Loader2,
  Check,
  Copy,
  ChevronRight,
  ChevronDown,
  Info,
  XCircle,
  Shield,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  useGcpSetupInfo,
  useCreateGcpConnection,
  useCreateGcpServiceAccountKeyConnection,
} from '@/hooks/queries/useIntegrationQueries';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SetupResultAlert, type SetupResult } from './SetupFormShared';

interface GcpSetupFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

export function GcpSetupForm({ onCreated, onCancel }: GcpSetupFormProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'impersonation' | 'service_account_key'>('service_account_key');
  const { data: setupInfo, isLoading, error } = useGcpSetupInfo(tab === 'impersonation');
  const createGcpMutation = useCreateGcpConnection();
  const createGcpServiceAccountKeyMutation = useCreateGcpServiceAccountKeyConnection();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [copied, setCopied] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [defaultProjectId, setDefaultProjectId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [targetServiceAccountEmail, setTargetServiceAccountEmail] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);

  const grantCommand = useMemo(() => {
    if (!setupInfo) return '';
    const target = targetServiceAccountEmail.trim() || 'TARGET_SERVICE_ACCOUNT_EMAIL';
    return `gcloud iam service-accounts add-iam-policy-binding ${target} \\\n  --member='${setupInfo.serviceAccountMember}' \\\n  --role='roles/iam.serviceAccountTokenCreator'`;
  }, [setupInfo, targetServiceAccountEmail]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy manually.', variant: 'destructive' });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);

    if (!displayName.trim() || !targetServiceAccountEmail.trim()) {
      setResult({
        ok: false,
        message: 'Display name and target service account email are required.',
      });
      return;
    }

    if (!targetServiceAccountEmail.endsWith('.gserviceaccount.com')) {
      setResult({ ok: false, message: 'Must be a valid *.gserviceaccount.com address.' });
      return;
    }

    try {
      await createGcpMutation.mutateAsync({
        displayName: displayName.trim(),
        targetServiceAccountEmail: targetServiceAccountEmail.trim(),
        defaultProjectId: defaultProjectId.trim() || undefined,
        organizationId: organizationId.trim() || undefined,
      });
      toast({ title: 'Google Cloud connection created' });
      onCreated();
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to create GCP connection.',
      });
    }
  };

  const handleServiceAccountKeySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);

    if (!displayName.trim() || !serviceAccountJson.trim()) {
      setResult({
        ok: false,
        message: 'Display name and service account JSON are required.',
      });
      return;
    }

    try {
      await createGcpServiceAccountKeyMutation.mutateAsync({
        displayName: displayName.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        defaultProjectId: defaultProjectId.trim() || undefined,
        organizationId: organizationId.trim() || undefined,
      });
      toast({ title: 'Google Cloud connection created' });
      onCreated();
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to create GCP connection.',
      });
    }
  };

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'impersonation' | 'service_account_key')}
      >
        <TabsList className="w-full">
          <TabsTrigger value="service_account_key" className="flex-1">
            Service Account JSON
          </TabsTrigger>
          <TabsTrigger value="impersonation" className="flex-1">
            Impersonation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="service_account_key" className="mt-4">
          <form onSubmit={handleServiceAccountKeySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gcp-display-name-key">Display Name *</Label>
              <Input
                id="gcp-display-name-key"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Production GCP"
                disabled={createGcpServiceAccountKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gcp-service-account-json">Service Account JSON *</Label>
              <textarea
                id="gcp-service-account-json"
                value={serviceAccountJson}
                onChange={(e) => setServiceAccountJson(e.target.value)}
                placeholder="{ ... }"
                disabled={createGcpServiceAccountKeyMutation.isPending}
                className="min-h-48 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gcp-default-project-key">Default Project ID</Label>
              <Input
                id="gcp-default-project-key"
                value={defaultProjectId}
                onChange={(e) => setDefaultProjectId(e.target.value)}
                placeholder="my-project-123"
                disabled={createGcpServiceAccountKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gcp-organization-id-key">Organization ID</Label>
              <Input
                id="gcp-organization-id-key"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                placeholder="123456789012"
                disabled={createGcpServiceAccountKeyMutation.isPending}
              />
            </div>

            <SetupResultAlert result={result} />

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={createGcpServiceAccountKeyMutation.isPending}>
                {createGcpServiceAccountKeyMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Connection'
                )}
              </Button>
            </DialogFooter>
          </form>
        </TabsContent>

        <TabsContent value="impersonation" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading setup info...</span>
            </div>
          ) : !setupInfo ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border p-3 text-sm border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {error instanceof Error
                    ? error.message
                    : 'Failed to load GCP setup details for impersonation.'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Service Account JSON remains available for the community edition path.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step indicator */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setResult(null);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    step === 1
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold border-current">
                    1
                  </span>
                  Create Service Account
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    step === 2
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold border-current">
                    2
                  </span>
                  Grant Permissions
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    step === 3
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold border-current">
                    3
                  </span>
                  Connection Details
                </button>
              </div>

              {/* Step 1: Create Service Account */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Create a Service Account</Label>
                    <p className="text-sm text-muted-foreground">
                      In your GCP project, go to{' '}
                      <strong>
                        IAM &amp; Admin &rarr; Service Accounts &rarr; Create Service Account
                      </strong>
                      . Give it a name like{' '}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8em] font-mono">
                        shipsec-reader
                      </code>
                      .
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Copy the email address of the service account you just created &mdash;
                      you&rsquo;ll need it in the next steps.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gcp-target-sa-step1">Target Service Account Email</Label>
                    <Input
                      id="gcp-target-sa-step1"
                      value={targetServiceAccountEmail}
                      onChange={(e) => setTargetServiceAccountEmail(e.target.value)}
                      placeholder="shipsec-reader@my-project.iam.gserviceaccount.com"
                    />
                  </div>

                  {/* Collapsible: Why Impersonation? */}
                  <div className="rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <button
                      type="button"
                      onClick={() => setWhyOpen((v) => !v)}
                      className="flex w-full items-center gap-2 p-3 text-left text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition-colors"
                    >
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">
                        Why impersonation instead of service-account keys?
                      </span>
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                          whyOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {whyOpen && (
                      <div className="px-3 pb-3 text-xs text-blue-700/80 dark:text-blue-300/80 space-y-2">
                        <ul className="list-disc pl-4 space-y-1">
                          <li>
                            <strong>No long-lived keys.</strong> ShipSec never stores customer JSON
                            keys. Access tokens are short-lived and auto-expire.
                          </li>
                          <li>
                            <strong>Revocable instantly.</strong> Remove one IAM binding to revoke
                            all access.
                          </li>
                          <li>
                            <strong>Auditable.</strong> GCP audit logs show every token generation
                            and API call made by the impersonated identity.
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={() => setStep(2)} className="gap-1.5">
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {/* Step 2: Grant Permissions */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Grant Permissions</Label>
                    <p className="text-sm text-muted-foreground">
                      Attach the following roles to the service account you created. Then grant
                      ShipSec permission to impersonate it.
                    </p>

                    {/* Required roles */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Required Roles
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                            <Eye className="h-3 w-3" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Viewer</p>
                            <p className="text-xs text-muted-foreground">
                              Read-only access to list and describe GCP resources (Compute, Storage,
                              GKE, Cloud SQL, etc.).
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                            <Shield className="h-3 w-3" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              Security Admin (or Security Reviewer)
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Read security configuration data for CSPM and compliance scanning.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                            <Eye className="h-3 w-3" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Service Usage Viewer</p>
                            <p className="text-xs text-muted-foreground">
                              List enabled APIs per project (required for inventory discovery).
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Org roles (optional) */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        For Organizations (optional)
                      </p>
                      <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                        <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                          <Shield className="h-3 w-3" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Organization Viewer + Role Viewer</p>
                          <p className="text-xs text-muted-foreground">
                            Org-level IAM inventory and role discovery. Only needed for org-wide
                            scans.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Impersonation grant command */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Grant Impersonation to ShipSec
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Run this command to let ShipSec impersonate your service account. No keys
                        are shared.
                      </p>
                      <div className="relative">
                        <pre className="rounded-md border bg-muted/50 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {grantCommand}
                        </pre>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2 h-7 gap-1.5 text-xs"
                          onClick={() => handleCopy(grantCommand)}
                        >
                          {copied ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" /> Copy
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        <strong>Tip:</strong> You can also assign these roles in the GCP Console
                        under <strong>IAM &amp; Admin &rarr; IAM &rarr; Grant Access</strong>.
                      </p>
                    </div>
                  </div>

                  <DialogFooter className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStep(1);
                        setResult(null);
                      }}
                    >
                      Back
                    </Button>
                    <Button type="button" onClick={() => setStep(3)} className="gap-1.5">
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {/* Step 3: Connection Details */}
              {step === 3 && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Enter the details of the service account you created and configured in the
                      previous steps.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="gcp-display-name">Display Name *</Label>
                      <Input
                        id="gcp-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Production GCP"
                        disabled={createGcpMutation.isPending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gcp-target-sa">Service Account Email *</Label>
                      <Input
                        id="gcp-target-sa"
                        value={targetServiceAccountEmail}
                        onChange={(e) => setTargetServiceAccountEmail(e.target.value)}
                        placeholder="shipsec-reader@my-project.iam.gserviceaccount.com"
                        disabled={createGcpMutation.isPending}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="gcp-project-id">Default Project ID (optional)</Label>
                        <Input
                          id="gcp-project-id"
                          value={defaultProjectId}
                          onChange={(e) => setDefaultProjectId(e.target.value)}
                          placeholder="my-project-123"
                          disabled={createGcpMutation.isPending}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gcp-org-id">Organization ID (optional)</Label>
                        <Input
                          id="gcp-org-id"
                          value={organizationId}
                          onChange={(e) => setOrganizationId(e.target.value)}
                          placeholder="123456789012"
                          disabled={createGcpMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>

                  <SetupResultAlert result={result} />

                  <DialogFooter className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStep(2);
                        setResult(null);
                      }}
                      disabled={createGcpMutation.isPending}
                    >
                      Back
                    </Button>
                    <Button type="submit" disabled={createGcpMutation.isPending}>
                      {createGcpMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
                        </>
                      ) : (
                        'Create Connection'
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
