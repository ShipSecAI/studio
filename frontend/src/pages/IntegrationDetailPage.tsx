import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
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

import { env } from '@/config/env';
import { useIntegrationStore } from '@/store/integrationStore';
import { api } from '@/services/api';
import type { IntegrationCatalogEntry, IntegrationConnection } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

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

const PROVIDER_VISUALS: Record<string, { logo: string; gradient: string; borderAccent: string }> = {
  aws: {
    logo: '/icons/aws.png',
    gradient: '',
    borderAccent: 'border-orange-200 dark:border-orange-800',
  },
  slack: {
    logo: '/icons/slack.svg',
    gradient: 'from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20',
    borderAccent: 'border-purple-200 dark:border-purple-800',
  },
};

function credentialTypeBadge(type: string) {
  const labels: Record<string, string> = {
    api_key: 'Access Key',
    iam_role: 'IAM Role',
    webhook: 'Webhook',
    oauth: 'OAuth',
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
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
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
  const store = useIntegrationStore();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [setupInfo, setSetupInfo] = useState<{
    platformRoleArn: string;
    externalId: string;
    setupToken: string;
    trustPolicyTemplate: string;
    externalIdDisplay?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [region, setRegion] = useState('');

  useEffect(() => {
    store
      .getAwsSetupInfo()
      .then(setSetupInfo)
      .catch((err) =>
        setResult({
          ok: false,
          message:
            err instanceof Error ? err.message : 'Failed to load setup info. Please try again.',
        }),
      )
      .finally(() => setLoadingSetup(false));
  }, []);

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
    setSubmitting(true);
    setResult(null);
    try {
      await store.createAwsConnection({
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
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingSetup) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading setup info...</span>
      </div>
    );
  }

  // Setup info failed — show error + cancel only
  if (!setupInfo) {
    return (
      <div className="space-y-4">
        {result && (
          <div className="flex items-start gap-2 rounded-md border p-3 text-sm border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{result.message}</span>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-5">
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

      {/* ── Step 1: Trust Policy ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Configure Trust Policy</Label>
            <p className="text-sm text-muted-foreground">
              In your AWS account, go to <strong>IAM &rarr; Roles &rarr; Create role</strong> and
              select <strong>&ldquo;Custom trust policy&rdquo;</strong> as the trusted entity type.
              Paste the JSON below as the trust policy. This allows ShipSec to securely access your
              account using a unique External ID &mdash; without you sharing any access keys.
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
          <div className="rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              className="flex w-full items-center gap-2 p-3 text-left text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition-colors"
            >
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Why IAM Role assumption instead of access keys?</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                  whyOpen && 'rotate-180',
                )}
              />
            </button>
            {whyOpen && (
              <div className="px-3 pb-3 text-xs text-blue-700/80 dark:text-blue-300/80 space-y-2">
                <p>
                  <strong>IAM Role assumption with an External ID</strong> is the AWS-recommended
                  approach for granting cross-account access. Here is why it is safer than sharing
                  access keys:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <strong>No long-lived credentials.</strong> Access keys are permanent secrets
                    that can be leaked or stolen. Role assumption uses temporary security tokens
                    (STS) that expire automatically.
                  </li>
                  <li>
                    <strong>Scoped permissions.</strong> The IAM role you create defines exactly
                    what ShipSec can do. You control the permission boundary, and can revoke access
                    at any time by deleting the role.
                  </li>
                  <li>
                    <strong>External ID prevents confused-deputy attacks.</strong> The unique
                    External ID in the trust policy ensures that only ShipSec &mdash; and
                    specifically your organization &mdash; can assume this role. No other party can
                    reuse this trust relationship.
                  </li>
                  <li>
                    <strong>Full audit trail.</strong> Every role assumption is logged in AWS
                    CloudTrail, giving you complete visibility into when and how ShipSec accesses
                    your account.
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

      {/* ── Step 2: Attach Permissions ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Attach Permissions</Label>
            <p className="text-sm text-muted-foreground">
              After creating the IAM role with the trust policy, attach the following AWS managed
              policies to define what ShipSec can access in your account.
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
                      Read-only access to security configuration data. Required for compliance
                      scanning and security posture assessment.
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
                      Read-only access to list and describe resources across AWS services. Used for
                      resource discovery and inventory.
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
                    Read-only access to AWS Organizations. Only needed on the management account to
                    discover and list member accounts.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <strong>Tip:</strong> In the AWS IAM console, search for each policy name in the
                &ldquo;Add permissions &rarr; Attach policies directly&rdquo; step and check the box
                to attach it. These are AWS managed policies &mdash; no custom policy JSON is
                needed.
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

      {/* ── Step 3: Connection Details ── */}
      {step === 3 && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter the details of the IAM role you created and configured in the previous steps.
            </p>
            <div className="space-y-2">
              <Label htmlFor="aws-display-name">Display Name *</Label>
              <Input
                id="aws-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Production AWS Account"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-role-arn">Role ARN *</Label>
              <Input
                id="aws-role-arn"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                placeholder="arn:aws:iam::123456789012:role/ShipSecAuditRole"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-region">Region (optional)</Label>
              <Input
                id="aws-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. us-east-1"
                disabled={submitting}
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
              disabled={submitting}
            >
              Back
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
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
  const store = useIntegrationStore();
  const { toast } = useToast();
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

      const conn = await store.createSlackWebhookConnection({
        displayName: whDisplayName.trim(),
        webhookUrl: whWebhookUrl.trim(),
      });

      // Auto-test
      try {
        const testResult = await store.testSlackConnection(conn.id);
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
      const redirectUri = `${env.VITE_APP_URL}/integrations/callback/slack`;
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
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
              <Button
                type="submit"
                disabled={submitting}
                className="gap-2 bg-[#4A154B] hover:bg-[#3a1139] text-white"
              >
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
              <img src="/icons/slack.svg" alt="Slack" className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium">Install ShipSec into your Slack workspace</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;ll be redirected to Slack to authorize the app.
              </p>
            </div>
            <Button
              onClick={handleOAuthConnect}
              disabled={submitting}
              className="gap-2 bg-[#4A154B] hover:bg-[#3a1139] text-white"
            >
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
                  icon: Send,
                  scope: 'im:write',
                  label: 'Direct messages',
                  desc: 'Send DMs to users for alerts and notifications',
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
// Main Page
// ---------------------------------------------------------------------------

export function IntegrationDetailPage() {
  const { provider } = useParams<{ provider: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const store = useIntegrationStore();
  const {
    catalog,
    orgConnections,
    loadingOrgConnections,
    loadingCatalog,
    fetchOrgConnections,
    fetchCatalog,
    validateAwsConnection,
    testSlackConnection,
    disconnect,
    error,
    resetError,
  } = store;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntegrationConnection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  // Fetch catalog and connections on mount
  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    if (provider) {
      fetchOrgConnections(undefined, true);
    }
  }, [provider, fetchOrgConnections]);

  // Show store errors as toasts
  useEffect(() => {
    if (error) {
      toast({ title: 'Error', description: error, variant: 'destructive' });
      resetError();
    }
  }, [error, toast, resetError]);

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

  const handleValidate = async (connection: IntegrationConnection) => {
    setValidatingId(connection.id);
    try {
      if (provider === 'aws') {
        const result = await validateAwsConnection(connection.id);
        if (result.valid) {
          toast({
            title: 'Validation passed',
            description: `${connection.displayName} credentials are valid.`,
          });
        } else {
          toast({
            title: 'Validation failed',
            description: result.error ?? 'Credentials are invalid.',
            variant: 'destructive',
          });
        }
      } else if (provider === 'slack') {
        const result = await testSlackConnection(connection.id);
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
      }
      // Refresh the connections list to pick up updated lastValidationStatus
      fetchOrgConnections(undefined, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation request failed.';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setValidatingId(null);
    }
  };

  const confirmDelete = (connection: IntegrationConnection) => {
    setDeleteTarget(connection);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await disconnect(deleteTarget.id);
      toast({
        title: 'Connection removed',
        description: `${deleteTarget.displayName} has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      fetchOrgConnections(undefined, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete connection.';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleConnectionCreated = () => {
    setDialogOpen(false);
    fetchOrgConnections(undefined, true);
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
          <Button variant="ghost" className="gap-2 mb-6" onClick={() => navigate('/integrations')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Integrations
          </Button>
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
    catalogEntry?.setupInstructions?.sections && catalogEntry.setupInstructions.sections.length > 0;

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl space-y-8">
        {/* Navigation */}
        <Button variant="ghost" className="gap-2" onClick={() => navigate('/integrations')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Integrations
        </Button>

        {/* ── Provider Header ── */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {visuals ? (
              visuals.gradient ? (
                <div
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br flex-shrink-0 p-3',
                    visuals.gradient,
                  )}
                >
                  <img
                    src={visuals.logo}
                    alt={catalogEntry?.name ?? provider ?? ''}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <img
                  src={visuals.logo}
                  alt={catalogEntry?.name ?? provider ?? ''}
                  className="h-16 w-16 rounded-xl object-cover flex-shrink-0"
                />
              )
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex-shrink-0 p-3">
                <Shield className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
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
                  provider === 'aws' || provider === 'slack' ? 'max-w-2xl' : 'max-w-lg',
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
                {provider === 'slack' && (
                  <SlackConnectionForm
                    onCreated={handleConnectionCreated}
                    onCancel={() => setDialogOpen(false)}
                  />
                )}
                {provider !== 'aws' && provider !== 'slack' && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No connection form is available for this provider yet.
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ── Connection Cards ── */}
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mx-auto mb-3">
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
                const meta = (conn.metadata ?? {}) as Record<string, any>;
                const providerPayload = meta.providerPayload ?? {};
                const teamName = providerPayload?.team?.name ?? conn.displayName;
                const teamId = providerPayload?.team?.id;
                const teamIcon: string | undefined = providerPayload?._teamIcon;
                const connVisuals = PROVIDER_VISUALS[conn.provider];

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
                          <img
                            src={connVisuals.logo}
                            alt={conn.provider}
                            className="h-10 w-10 rounded-lg flex-shrink-0 object-contain bg-muted p-1"
                          />
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
                      <div className="flex items-center gap-2 pt-2 border-t">
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

        {/* ── Two-column bottom: Setup Instructions + Info Sidebar ── */}
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
                      <p className="text-2xl font-bold">{connections.length}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
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
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
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
