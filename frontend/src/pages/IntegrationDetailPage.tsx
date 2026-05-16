import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Plus,
  Trash2,
  RefreshCcw,
  CheckCircle,
  XCircle,
  ExternalLink,
  Loader2,
  Shield,
  MessageSquare,
  Copy,
  Check,
  ChevronDown,
  Info,
  ChevronRight,
  Hash,
  Terminal,
  Send,
  Eye,
} from 'lucide-react';

import { api } from '@/services/api';
import type { IntegrationCatalogEntry, IntegrationConnection } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  useIntegrationCatalog,
  useIntegrationConnections,
  useAwsSetupInfo,
  useCreateAwsAccessKeyConnection,
  useCreateAwsConnection,
  useCreateJiraForgeConnection,
  useCreateSlackWebhookConnection,
  useValidateGcpConnection,
  useValidateAwsConnection,
  useDiscoverGcpProjects,
  useTestSlackConnection,
  useDisconnectIntegration,
} from '@/hooks/queries/useIntegrationQueries';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { GcpSetupForm } from '@/components/integrations/GcpSetupForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const PROVIDER_VISUALS: Record<
  string,
  {
    logo?: string;
    darkLogo?: string;
    gradient?: string;
    borderAccent?: string;
    darkBg?: boolean;
    monogram?: string;
    monogramClassName?: string;
  }
> = {
  aws: {
    logo: '/icons/aws.svg',
    darkLogo: '/icons/aws-dark.svg',
    darkBg: true,
  },
  gcp: {
    logo: '/icons/gcp.svg',
  },
  slack: {
    logo: '/icons/slack.svg',
  },
  jira: {
    logo: '/icons/jira.svg',
  },
};

function credentialTypeBadge(type: string) {
  const labels: Record<string, string> = {
    api_key: 'Access Key',
    access_key: 'Access Key',
    iam_role: 'IAM Role',
    service_account: 'Service Account',
    service_account_key: 'Service Account Key',
    webhook: 'Webhook',
    oauth: 'OAuth',
    forge_app: 'Jira App',
  };
  return (
    <Badge variant="outline" className="capitalize">
      {labels[type] ?? type}
    </Badge>
  );
}

function healthBadge(connection: IntegrationConnection) {
  const status = connection.lastValidationStatus ?? connection.status;
  if (status === 'active' || status === 'valid' || status === 'ok') {
    return (
      <Badge variant="outline" className="gap-1 border-border/80 bg-background/70 text-success">
        <CheckCircle className="h-3 w-3" />
        Healthy
      </Badge>
    );
  }
  if (status === 'expired' || status === 'invalid' || status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {status === 'expired' ? 'Expired' : 'Unhealthy'}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      {connection.status}
    </Badge>
  );
}

/** Renders step text with inline `code` segments styled as <code> elements. */
function renderStepText(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[0.8em] font-mono break-all">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ---------------------------------------------------------------------------
// AWS Connection Form
// ---------------------------------------------------------------------------

interface AwsFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function AwsConnectionForm({ onCreated, onCancel }: AwsFormProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'iam_role' | 'access_key'>('access_key');
  const {
    data: setupInfo,
    isLoading: loadingSetup,
    error: setupError,
  } = useAwsSetupInfo(tab === 'iam_role');
  const createAwsMutation = useCreateAwsConnection();
  const createAwsAccessKeyMutation = useCreateAwsAccessKeyConnection();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [region, setRegion] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');

  const handleCopyPolicy = async () => {
    if (!setupInfo) return;
    try {
      await navigator.clipboard.writeText(setupInfo.trustPolicyTemplate);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Please select and copy the policy manually.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupInfo) return;
    if (!displayName.trim() || !roleArn.trim()) {
      setResult({ ok: false, message: 'Display Name and Role ARN are required.' });
      return;
    }
    setResult(null);
    try {
      await createAwsMutation.mutateAsync({
        displayName: displayName.trim(),
        roleArn: roleArn.trim(),
        region: region.trim() || undefined,
        externalId: setupInfo.externalId,
        setupToken: setupInfo.setupToken,
      });
      toast({ title: 'AWS connection created' });
      onCreated();
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to create connection.',
      });
    }
  };

  const handleAccessKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      setResult({
        ok: false,
        message: 'Display Name, Access Key ID, and Secret Access Key are required.',
      });
      return;
    }
    setResult(null);
    try {
      await createAwsAccessKeyMutation.mutateAsync({
        displayName: displayName.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        sessionToken: sessionToken.trim() || undefined,
        region: region.trim() || undefined,
      });
      toast({ title: 'AWS connection created' });
      onCreated();
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to create connection.',
      });
    }
  };

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'iam_role' | 'access_key')}>
        <TabsList className="w-full">
          <TabsTrigger value="iam_role" className="flex-1">
            IAM Role
          </TabsTrigger>
          <TabsTrigger value="access_key" className="flex-1">
            Access Key
          </TabsTrigger>
        </TabsList>

        <TabsContent value="access_key" className="mt-4">
          <form onSubmit={handleAccessKeySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aws-display-name-key">Display Name *</Label>
              <Input
                id="aws-display-name-key"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Production AWS Account"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-access-key-id">Access Key ID *</Label>
              <Input
                id="aws-access-key-id"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AKIA..."
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-secret-access-key">Secret Access Key *</Label>
              <Input
                id="aws-secret-access-key"
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="••••••••"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-session-token">Session Token</Label>
              <Input
                id="aws-session-token"
                type="password"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                placeholder="Optional"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-region-key">Region</Label>
              <Input
                id="aws-region-key"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>

            {result && (
              <div
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  result.ok
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                    : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                }`}
              >
                {result.ok ? (
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <span>{result.message}</span>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={createAwsAccessKeyMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createAwsAccessKeyMutation.isPending}>
                {createAwsAccessKeyMutation.isPending ? (
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

        <TabsContent value="iam_role" className="mt-4">
          {loadingSetup ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading setup info...</span>
            </div>
          ) : !setupInfo ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border p-3 text-sm border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {setupError instanceof Error
                    ? setupError.message
                    : 'Failed to load AWS IAM role setup info.'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Access Key remains available for the community edition path.
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
                  Configure Trust Policy
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
                  Attach Permissions
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

              {/* Step 1: Trust Policy */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Configure Trust Policy</Label>
                    <p className="text-sm text-muted-foreground">
                      In your AWS account, go to{' '}
                      <strong>IAM &rarr; Roles &rarr; Create role</strong> and select{' '}
                      <strong>&ldquo;Custom trust policy&rdquo;</strong> as the trusted entity type.
                      Paste the JSON below as the trust policy. This allows ShipSec to securely
                      access your account using a unique External ID &mdash; without you sharing any
                      access keys.
                    </p>
                    <div className="relative">
                      <pre className="rounded-md border bg-muted/50 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {setupInfo.trustPolicyTemplate}
                      </pre>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 h-7 gap-1.5 text-xs"
                        onClick={handleCopyPolicy}
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

                  {/* Collapsible: Why IAM Role Assumption? */}
                  <div className="rounded-md border bg-muted/25">
                    <button
                      type="button"
                      onClick={() => setWhyOpen((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-md p-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">
                        Why IAM Role assumption instead of access keys?
                      </span>
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                          whyOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {whyOpen && (
                      <div className="space-y-2 px-3 pb-3 text-xs text-muted-foreground">
                        <p>
                          <strong>IAM Role assumption with an External ID</strong> is the
                          AWS-recommended approach for granting cross-account access. Here is why it
                          is safer than sharing access keys:
                        </p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>
                            <strong>No long-lived credentials.</strong> Access keys are permanent
                            secrets that can be leaked or stolen. Role assumption uses temporary
                            security tokens (STS) that expire automatically.
                          </li>
                          <li>
                            <strong>Scoped permissions.</strong> The IAM role you create defines
                            exactly what ShipSec can do. You control the permission boundary, and
                            can revoke access at any time by deleting the role.
                          </li>
                          <li>
                            <strong>External ID prevents confused-deputy attacks.</strong> The
                            unique External ID in the trust policy ensures that only ShipSec &mdash;
                            and specifically your organization &mdash; can assume this role. No
                            other party can reuse this trust relationship.
                          </li>
                          <li>
                            <strong>Full audit trail.</strong> Every role assumption is logged in
                            AWS CloudTrail, giving you complete visibility into when and how ShipSec
                            accesses your account.
                          </li>
                        </ul>
                        <p className="pt-1">
                          For more details, see the{' '}
                          <a
                            href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-medium"
                          >
                            AWS documentation on External IDs
                          </a>
                          .
                        </p>
                      </div>
                    )}
                  </div>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={() => setStep(2)} className="gap-1.5">
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {/* Step 2: Attach Permissions */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Attach Permissions</Label>
                    <p className="text-sm text-muted-foreground">
                      After creating the IAM role with the trust policy, attach the following AWS
                      managed policies to define what ShipSec can access in your account.
                    </p>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Required Policies
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                            <Shield className="h-3 w-3" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">SecurityAudit</p>
                            <p className="text-xs text-muted-foreground">
                              Read-only access to security configuration data. Required for
                              compliance scanning and security posture assessment.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                            <Eye className="h-3 w-3" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">ViewOnlyAccess</p>
                            <p className="text-xs text-muted-foreground">
                              Read-only access to list and describe resources across AWS services.
                              Used for resource discovery and inventory.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        For Organizations (management account only)
                      </p>
                      <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
                        <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                          <Shield className="h-3 w-3" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">OrganizationsReadOnlyAccess</p>
                          <p className="text-xs text-muted-foreground">
                            Read-only access to AWS Organizations. Only needed on the management
                            account to discover and list member accounts.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border bg-muted/25 p-3">
                      <p className="text-xs text-muted-foreground">
                        <strong>Tip:</strong> In the AWS IAM console, search for each policy name in
                        the &ldquo;Add permissions &rarr; Attach policies directly&rdquo; step and
                        check the box to attach it. These are AWS managed policies &mdash; no custom
                        policy JSON is needed.
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
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {/* Step 3: Connection Details */}
              {step === 3 && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Enter the details of the IAM role you created and configured in the previous
                      steps.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="aws-display-name">Display Name *</Label>
                      <Input
                        id="aws-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Production AWS Account"
                        disabled={createAwsMutation.isPending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aws-role-arn">Role ARN *</Label>
                      <Input
                        id="aws-role-arn"
                        value={roleArn}
                        onChange={(e) => setRoleArn(e.target.value)}
                        placeholder="arn:aws:iam::123456789012:role/ShipSecAuditRole"
                        disabled={createAwsMutation.isPending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aws-region">Region (optional)</Label>
                      <Input
                        id="aws-region"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        placeholder="e.g. us-east-1"
                        disabled={createAwsMutation.isPending}
                      />
                    </div>
                  </div>

                  {result && (
                    <div
                      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                        result.ok
                          ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                          : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                      }`}
                    >
                      {result.ok ? (
                        <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      )}
                      <span>{result.message}</span>
                    </div>
                  )}

                  <DialogFooter className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStep(2);
                        setResult(null);
                      }}
                      disabled={createAwsMutation.isPending}
                    >
                      Back
                    </Button>
                    <Button type="submit" disabled={createAwsMutation.isPending}>
                      {createAwsMutation.isPending ? (
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
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slack Connection Form
// ---------------------------------------------------------------------------

interface SlackFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function SlackConnectionForm({ onCreated, onCancel }: SlackFormProps) {
  const { toast } = useToast();
  const createSlackMutation = useCreateSlackWebhookConnection();
  const testSlackMutation = useTestSlackConnection();

  const [tab, setTab] = useState<string>('oauth');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Webhook fields
  const [whDisplayName, setWhDisplayName] = useState('');
  const [whWebhookUrl, setWhWebhookUrl] = useState('');

  const resetForm = () => {
    setWhDisplayName('');
    setWhWebhookUrl('');
    setResult(null);
  };

  const handleWebhookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      if (!whDisplayName.trim() || !whWebhookUrl.trim()) {
        setResult({ ok: false, message: 'Display name and Webhook URL are required.' });
        setSubmitting(false);
        return;
      }

      const conn = await createSlackMutation.mutateAsync({
        displayName: whDisplayName.trim(),
        webhookUrl: whWebhookUrl.trim(),
      });

      // Auto-test
      try {
        const testResult = await testSlackMutation.mutateAsync({ id: conn.id });
        if (testResult.ok) {
          setResult({
            ok: true,
            message: 'Webhook connection created and test message sent successfully.',
          });
        } else {
          setResult({
            ok: false,
            message: `Connection created but test failed: ${testResult.error ?? 'Unknown error'}`,
          });
        }
      } catch {
        setResult({
          ok: true,
          message: 'Connection created. Test message could not be sent automatically.',
        });
      }

      toast({
        title: 'Slack webhook connection created',
        description: 'The webhook has been stored.',
      });
      resetForm();
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create Slack connection.';
      setResult({ ok: false, message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuthConnect = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const redirectUri = `${window.location.origin}/integrations/callback/slack`;
      const response = await api.integrations.startOAuth('slack', { redirectUri });
      window.location.href = response.authorizationUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Slack OAuth flow.';
      setResult({ ok: false, message });
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="oauth" className="flex-1">
            OAuth
          </TabsTrigger>
          <TabsTrigger value="webhook" className="flex-1">
            Webhook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="webhook" className="mt-4 space-y-4">
          {/* Main CTA */}
          <div className="flex flex-col items-center text-center py-2 space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted">
              <img src="/icons/slack.svg" alt="Slack" className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium">Send alerts to a Slack channel via Webhook</p>
              <p className="text-xs text-muted-foreground mt-1">
                Paste an incoming webhook URL to post messages directly to a channel.
              </p>
            </div>
          </div>

          <form onSubmit={handleWebhookSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh-display-name">Display Name *</Label>
              <Input
                id="wh-display-name"
                value={whDisplayName}
                onChange={(e) => setWhDisplayName(e.target.value)}
                placeholder="e.g. Security Alerts Channel"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-webhook-url">Webhook URL *</Label>
              <Input
                id="wh-webhook-url"
                value={whWebhookUrl}
                onChange={(e) => setWhWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/T.../B.../..."
                autoComplete="off"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Create an incoming webhook in your Slack workspace settings.
              </p>
            </div>

            {result && tab === 'webhook' && (
              <div
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  result.ok
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                    : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                }`}
              >
                {result.ok ? (
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <span>{result.message}</span>
              </div>
            )}

            <div className="flex justify-center pt-2">
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <img src="/icons/slack.svg" alt="" className="h-4 w-4 brightness-0 invert" />
                    Add to Channel
                  </>
                )}
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
            </DialogFooter>
          </form>
        </TabsContent>

        <TabsContent value="oauth" className="mt-4 space-y-4">
          {/* Main CTA */}
          <div className="flex flex-col items-center text-center py-2 space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted">
              <img src="/icons/slack.svg" alt="Slack" className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium">Install ShipSec into your Slack workspace</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;ll be redirected to Slack to authorize the app.
              </p>
            </div>
            <Button onClick={handleOAuthConnect} disabled={submitting} className="gap-2">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting to Slack...
                </>
              ) : (
                <>
                  <img src="/icons/slack.svg" alt="" className="h-4 w-4 brightness-0 invert" />
                  Add to Slack
                </>
              )}
            </Button>
          </div>

          {/* Permissions breakdown */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
              Permissions requested
            </p>
            <div className="rounded-md border divide-y">
              {[
                {
                  icon: Eye,
                  scope: 'channels:read',
                  label: 'View channels',
                  desc: 'List public channels in your workspace',
                },
                {
                  icon: MessageSquare,
                  scope: 'chat:write',
                  label: 'Send messages',
                  desc: 'Post messages to channels the bot is in',
                },
                {
                  icon: Hash,
                  scope: 'chat:write.public',
                  label: 'Send to any channel',
                  desc: 'Post to channels without being a member',
                },
                {
                  icon: Terminal,
                  scope: 'commands',
                  label: 'Slash commands',
                  desc: 'Respond to /shipsec commands',
                },
                {
                  icon: MessageSquare,
                  scope: 'channels:history',
                  label: 'Read thread context',
                  desc: 'Read channel history so ShipSec can continue threaded conversations',
                },
                {
                  icon: Send,
                  scope: 'app_mentions:read',
                  label: 'Mentions',
                  desc: 'Listen for @shipsec mentions that should start or resume a thread',
                },
                {
                  icon: Info,
                  scope: 'team:read',
                  label: 'Workspace details',
                  desc: 'Read basic workspace info needed to label and validate the connection',
                },
              ].map(({ icon: Icon, scope, label, desc }) => (
                <div key={scope} className="flex items-start gap-3 px-3 py-2.5">
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded">
                        {scope}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result && tab === 'oauth' && (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                result.ok
                  ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span>{result.message}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          </DialogFooter>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jira Connection Form
// ---------------------------------------------------------------------------

interface JiraFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function JiraConnectionForm({ onCreated, onCancel }: JiraFormProps) {
  const { toast } = useToast();
  const createJiraMutation = useCreateJiraForgeConnection();
  const [tab, setTab] = useState<'oauth' | 'forge_app'>('oauth');
  const [displayName, setDisplayName] = useState('Jira');
  const [webTriggerUrl, setWebTriggerUrl] = useState('');
  const [sharedSecret, setSharedSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !webTriggerUrl.trim()) {
      setErrorMessage('Connection name and web trigger URL are required.');
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      await createJiraMutation.mutateAsync({
        displayName: displayName.trim(),
        webTriggerUrl: webTriggerUrl.trim(),
        sharedSecret: sharedSecret.trim() || undefined,
      });
      toast({ title: 'Jira connected' });
      onCreated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect Jira.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuthConnect = async () => {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const redirectUri = `${window.location.origin}/integrations/callback/jira`;
      const response = await api.integrations.startOAuth('jira', { redirectUri });
      window.location.href = response.authorizationUrl;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start Jira OAuth flow.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 py-2">
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'oauth' | 'forge_app')}>
        <TabsList className="w-full">
          <TabsTrigger value="oauth" className="flex-1">
            OAuth
          </TabsTrigger>
          <TabsTrigger value="forge_app" className="flex-1">
            Jira App
          </TabsTrigger>
        </TabsList>

        <TabsContent value="oauth" className="mt-4 space-y-4">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border bg-muted">
              <img src="/icons/jira.svg" alt="Jira" className="h-8 w-8" />
            </div>
            <p className="text-base font-semibold">Connect Jira with Atlassian OAuth</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Authorize Studio to create and manage Jira issues through the Jira Cloud REST API.
            </p>
            <Button onClick={handleOAuthConnect} disabled={submitting} className="gap-2">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                'Connect Jira'
              )}
            </Button>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
              <span className="flex items-center gap-2">
                <XCircle className="h-4 w-4" /> {errorMessage}
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          </DialogFooter>
        </TabsContent>

        <TabsContent value="forge_app" className="mt-4">
          <div className="flex flex-col items-center text-center space-y-3 mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border bg-muted">
              <img src="/icons/jira.svg" alt="Jira" className="h-8 w-8" />
            </div>
            <p className="text-base font-semibold">Connect a self-managed Jira app</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Paste your Jira app web trigger URL to let Studio call that app directly.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="jira-display-name">Connection Name</Label>
              <Input
                id="jira-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jira Production"
                disabled={submitting}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jira-web-trigger">Web Trigger URL</Label>
              <Input
                id="jira-web-trigger"
                value={webTriggerUrl}
                onChange={(e) => setWebTriggerUrl(e.target.value)}
                placeholder="https://xxxx.hello.atlassian-dev.net/x1/..."
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Run <code className="rounded bg-muted px-1 py-0.5">forge webtrigger</code> or the
                equivalent for your Jira app, then paste the resulting URL here.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="jira-secret">Shared Secret</Label>
              <Input
                id="jira-secret"
                type="password"
                value={sharedSecret}
                onChange={(e) => setSharedSecret(e.target.value)}
                placeholder="Optional"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Optional. If your Jira app validates a shared secret, Studio will send it as{' '}
                <code className="rounded bg-muted px-1 py-0.5">x-shipsec-secret</code>.
              </p>
            </div>

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                <span className="flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> {errorMessage}
                </span>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !displayName.trim() || !webTriggerUrl.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...
                  </>
                ) : (
                  'Connect Jira App'
                )}
              </Button>
            </DialogFooter>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function IntegrationDetailPage() {
  const { provider } = useParams<{ provider: string }>();
  const { toast } = useToast();

  const { data: catalog = [], isLoading: loadingCatalog } = useIntegrationCatalog();
  const { data: orgConnections = [], isLoading: loadingOrgConnections } =
    useIntegrationConnections();
  const validateAwsMutation = useValidateAwsConnection();
  const validateGcpMutation = useValidateGcpConnection();
  const discoverGcpProjectsMutation = useDiscoverGcpProjects();
  const testSlackMutation = useTestSlackConnection();
  const disconnectMutation = useDisconnectIntegration();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntegrationConnection | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);

  const catalogEntry: IntegrationCatalogEntry | undefined = useMemo(() => {
    return catalog.find((c) => c.id === provider);
  }, [catalog, provider]);

  const connections = useMemo(() => {
    if (!provider) return [];
    return orgConnections.filter((c) => c.provider === provider);
  }, [orgConnections, provider]);

  const visuals = PROVIDER_VISUALS[provider ?? ''];

  const healthyCount = useMemo(() => {
    return connections.filter((c) => {
      const s = c.lastValidationStatus ?? c.status;
      return s === 'active' || s === 'valid' || s === 'ok';
    }).length;
  }, [connections]);

  // ---- Actions ----

  const handleValidate = (connection: IntegrationConnection) => {
    setValidatingId(connection.id);
    const onSettled = () => setValidatingId(null);

    if (provider === 'aws') {
      validateAwsMutation.mutate(
        { id: connection.id },
        {
          onSuccess: () =>
            toast({
              title: 'Validation passed',
              description: `${connection.displayName} credentials are valid.`,
            }),
          onError: (err) =>
            toast({
              title: 'Validation failed',
              description: err instanceof Error ? err.message : 'Validation request failed.',
              variant: 'destructive',
            }),
          onSettled,
        },
      );
    } else if (provider === 'gcp') {
      validateGcpMutation.mutate(
        { id: connection.id },
        {
          onSuccess: (result) =>
            toast({
              title: result.valid ? 'Validation passed' : 'Validation failed',
              description: result.valid
                ? `${result.serviceAccountEmail ?? connection.displayName} can access ${result.projects?.length ?? 0} project${(result.projects?.length ?? 0) === 1 ? '' : 's'}.`
                : (result.error ?? 'Google Cloud validation failed.'),
              variant: result.valid ? 'default' : 'destructive',
            }),
          onError: (err) =>
            toast({
              title: 'Validation failed',
              description: err instanceof Error ? err.message : 'Validation request failed.',
              variant: 'destructive',
            }),
          onSettled,
        },
      );
    } else if (provider === 'slack') {
      testSlackMutation.mutate(
        { id: connection.id },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast({
                title: 'Test passed',
                description: `${connection.displayName} connection is healthy.`,
              });
            } else {
              toast({
                title: 'Test failed',
                description: result.error ?? 'Connection test failed.',
                variant: 'destructive',
              });
            }
          },
          onError: (err) =>
            toast({
              title: 'Test failed',
              description: err instanceof Error ? err.message : 'Connection test failed.',
              variant: 'destructive',
            }),
          onSettled,
        },
      );
    }
  };

  const handleDiscoverProjects = (connection: IntegrationConnection) => {
    setDiscoveringId(connection.id);
    discoverGcpProjectsMutation.mutate(
      { id: connection.id },
      {
        onSuccess: (result) =>
          toast({
            title: 'Projects discovered',
            description:
              result.resources.length > 0
                ? `${result.resources.length} Google Cloud resources are visible to ${connection.displayName}.`
                : `${connection.displayName} did not return any projects or folders.`,
          }),
        onError: (err) =>
          toast({
            title: 'Discovery failed',
            description: err instanceof Error ? err.message : 'Failed to discover GCP projects.',
            variant: 'destructive',
          }),
        onSettled: () => setDiscoveringId(null),
      },
    );
  };

  const confirmDelete = (connection: IntegrationConnection) => {
    setDeleteTarget(connection);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await disconnectMutation.mutateAsync({ id: deleteTarget.id });
      toast({
        title: 'Connection removed',
        description: `${deleteTarget.displayName} has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete connection.';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    }
  };

  const handleConnectionCreated = () => {
    setDialogOpen(false);
  };

  // ---- Loading state ----

  if (loadingCatalog && !catalogEntry) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-8 px-4 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // ---- Unknown provider ----

  if (!loadingCatalog && !catalogEntry) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-8 px-4">
          <Card>
            <CardContent className="py-12 text-center">
              <XCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <h2 className="text-lg font-semibold mb-1">Provider not found</h2>
              <p className="text-sm text-muted-foreground">
                The integration provider &quot;{provider}&quot; is not available in the catalog.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ---- Render ----

  const hasSetupSections =
    provider !== 'jira' &&
    catalogEntry?.setupInstructions?.sections &&
    catalogEntry.setupInstructions.sections.length > 0;

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl space-y-8">
        {/* Provider Header */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {visuals ? (
              visuals.logo && visuals.darkBg ? (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border bg-muted p-3">
                  <img
                    src={visuals.darkLogo ?? visuals.logo}
                    alt={catalogEntry?.name ?? provider ?? ''}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : visuals.logo ? (
                <img
                  src={visuals.logo}
                  alt={catalogEntry?.name ?? provider ?? ''}
                  className="h-16 w-16 flex-shrink-0 rounded-xl border bg-muted object-contain p-3"
                />
              ) : (
                <div
                  className={cn(
                    'flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border bg-muted text-base font-semibold tracking-wide text-muted-foreground',
                    visuals.monogramClassName,
                  )}
                >
                  {visuals.monogram ??
                    (catalogEntry?.name ?? provider ?? '?').slice(0, 3).toUpperCase()}
                </div>
              )
            ) : (
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border bg-muted p-3">
                <Shield className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {catalogEntry?.name ?? provider}
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {catalogEntry?.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {catalogEntry?.docsUrl && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => window.open(catalogEntry.docsUrl, '_blank', 'noopener noreferrer')}
              >
                <ExternalLink className="h-4 w-4" />
                Docs
              </Button>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Connection
                </Button>
              </DialogTrigger>
              <DialogContent
                className={cn(
                  provider === 'aws' || provider === 'slack' || provider === 'gcp'
                    ? 'max-w-2xl'
                    : 'max-w-lg',
                )}
              >
                <DialogHeader>
                  <DialogTitle>Add {catalogEntry?.name ?? provider} Connection</DialogTitle>
                  <DialogDescription>
                    Configure a new connection to {catalogEntry?.name ?? provider}.
                  </DialogDescription>
                </DialogHeader>

                {provider === 'aws' && (
                  <AwsConnectionForm
                    onCreated={handleConnectionCreated}
                    onCancel={() => setDialogOpen(false)}
                  />
                )}
                {provider === 'gcp' && (
                  <GcpSetupForm
                    onCreated={handleConnectionCreated}
                    onCancel={() => setDialogOpen(false)}
                  />
                )}
                {provider === 'slack' && (
                  <SlackConnectionForm
                    onCreated={handleConnectionCreated}
                    onCancel={() => setDialogOpen(false)}
                  />
                )}
                {provider === 'jira' && (
                  <JiraConnectionForm
                    onCreated={handleConnectionCreated}
                    onCancel={() => setDialogOpen(false)}
                  />
                )}
                {provider !== 'aws' &&
                  provider !== 'gcp' &&
                  provider !== 'slack' &&
                  provider !== 'jira' && (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      No connection form is available for this provider yet.
                    </div>
                  )}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Connection Cards */}
        <div>
          <h2 className="text-lg font-semibold mb-4">
            Connections
            {connections.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({connections.length})
              </span>
            )}
          </h2>

          {loadingOrgConnections ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : connections.length === 0 ? (
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => setDialogOpen(true)}
            >
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border bg-muted">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-medium mb-1">No connections yet</h3>
              <p className="text-sm text-muted-foreground">
                Click to add your first {catalogEntry?.name ?? provider} connection.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map((conn) => {
                const isValidating = validatingId === conn.id;
                const isDiscovering = discoveringId === conn.id;
                const meta = (conn.metadata ?? {}) as Record<string, any>;
                const providerPayload = meta.providerPayload ?? {};
                const teamName = providerPayload?.team?.name ?? conn.displayName;
                const teamId = providerPayload?.team?.id;
                const teamIcon: string | undefined = providerPayload?._teamIcon;
                const connVisuals = PROVIDER_VISUALS[conn.provider];
                const discoveredResources = Array.isArray(meta.discoveredResources)
                  ? meta.discoveredResources
                  : [];
                const gcpScope =
                  typeof meta.defaultProjectId === 'string'
                    ? meta.defaultProjectId
                    : typeof meta.organizationId === 'string'
                      ? meta.organizationId
                      : null;
                const canValidate =
                  provider === 'aws' || provider === 'gcp' || provider === 'slack';
                const canDiscoverProjects = provider === 'gcp';

                return (
                  <Card
                    key={conn.id}
                    className={cn(
                      'overflow-hidden transition-shadow hover:shadow-md',
                      connVisuals?.borderAccent,
                    )}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {teamIcon ? (
                          <img
                            src={teamIcon}
                            alt={teamName}
                            className="h-10 w-10 rounded-lg flex-shrink-0 object-cover"
                          />
                        ) : connVisuals?.logo ? (
                          connVisuals.darkBg ? (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 bg-[#232F3E] p-1.5">
                              <img
                                src={connVisuals.darkLogo ?? connVisuals.logo}
                                alt={conn.provider}
                                className="h-full w-full object-contain"
                              />
                            </div>
                          ) : (
                            <img
                              src={connVisuals.logo}
                              alt={conn.provider}
                              className="h-10 w-10 rounded-lg flex-shrink-0 object-contain bg-muted p-1"
                            />
                          )
                        ) : connVisuals?.monogram ? (
                          <div
                            className={cn(
                              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border bg-muted text-xs font-semibold tracking-wide text-muted-foreground',
                              connVisuals.monogramClassName,
                            )}
                          >
                            {connVisuals.monogram}
                          </div>
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 bg-muted text-muted-foreground font-semibold text-sm">
                            {(teamName ?? '?').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm truncate">{teamName}</h3>
                            {healthBadge(conn)}
                          </div>
                          {teamId && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {teamId}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {credentialTypeBadge(conn.credentialType ?? 'unknown')}
                        {conn.scopes && conn.scopes.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {conn.scopes.length} scope{conn.scopes.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Connected {formatTimestamp(conn.createdAt)}
                      </p>
                      {provider === 'gcp' && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {typeof meta.clientEmail === 'string' && (
                            <p className="truncate">Service account: {meta.clientEmail}</p>
                          )}
                          {gcpScope && <p className="truncate">Scope: {gcpScope}</p>}
                          {discoveredResources.length > 0 && (
                            <p className="truncate">
                              Discovered: {discoveredResources.length} project
                              {discoveredResources.length === 1 ? '' : 's'}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-2 border-t">
                        {canValidate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs flex-1"
                            disabled={isValidating}
                            onClick={() => handleValidate(conn)}
                          >
                            {isValidating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCcw className="h-3.5 w-3.5" />
                            )}
                            {provider === 'slack' ? 'Test' : 'Validate'}
                          </Button>
                        )}
                        {canDiscoverProjects && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs flex-1"
                            disabled={isDiscovering}
                            onClick={() => handleDiscoverProjects(conn)}
                          >
                            {isDiscovering ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Terminal className="h-3.5 w-3.5" />
                            )}
                            Discover Projects
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                          onClick={() => confirmDelete(conn)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Add Connection card */}
              <Card
                className="overflow-hidden border-2 border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setDialogOpen(true)}
              >
                <CardContent className="p-4 h-full flex flex-col items-center justify-center gap-2 min-h-[160px]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Plus className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Add Connection</span>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Two-column bottom: Setup Instructions + Info Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left column: Setup Instructions */}
          {hasSetupSections && (
            <div className="lg:col-span-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Setup</CardTitle>
                  <CardDescription>
                    Choose a scenario that matches your environment.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs
                    defaultValue={catalogEntry!.setupInstructions.sections[0]?.scenario}
                    className="w-full"
                  >
                    <TabsList className="w-full h-auto flex-wrap">
                      {catalogEntry!.setupInstructions.sections.map((section) => (
                        <TabsTrigger
                          key={section.scenario}
                          value={section.scenario}
                          className="flex-1 text-xs"
                        >
                          {section.title}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {catalogEntry!.setupInstructions.sections.map((section) => (
                      <TabsContent key={section.scenario} value={section.scenario} className="mt-4">
                        <ol className="space-y-3">
                          {section.steps.map((step, stepIdx) => (
                            <li
                              key={stepIdx}
                              className="flex gap-3 text-sm text-muted-foreground leading-relaxed"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {stepIdx + 1}
                              </span>
                              <span className="pt-0.5">{renderStepText(step)}</span>
                            </li>
                          ))}
                        </ol>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Right column: Info Sidebar */}
          <div className={hasSetupSections ? 'lg:col-span-2' : 'lg:col-span-5'}>
            <div className="space-y-4">
              {/* Documentation link */}
              {catalogEntry?.docsUrl && (
                <Card>
                  <CardContent className="p-4">
                    <a
                      href={catalogEntry.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-sm font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      View {catalogEntry.name} Documentation
                    </a>
                  </CardContent>
                </Card>
              )}

              {/* Connection stats */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Connection Summary</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md bg-muted/50 p-3 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{connections.length}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3 text-center">
                      <p className="text-2xl font-semibold tabular-nums text-success">
                        {healthyCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Healthy</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Auth methods */}
              {catalogEntry?.authMethods && catalogEntry.authMethods.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-sm font-semibold">Supported Auth Methods</h3>
                    <div className="flex flex-wrap gap-2">
                      {catalogEntry.authMethods.map((method) => (
                        <Badge key={method.type} variant="secondary" className="gap-1.5">
                          <Shield className="h-3 w-3" />
                          {method.label}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.displayName}&quot;? This action
              cannot be undone. Any workflows using this connection will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={disconnectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
