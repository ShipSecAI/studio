import { useState } from 'react';
import {
  Loader2,
  Shield,
  Copy,
  Check,
  ChevronDown,
  Info,
  ChevronRight,
  CheckCircle,
  XCircle,
  Eye,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  useAwsSetupInfo,
  useCreateAwsAccessKeyConnection,
  useCreateAwsConnection,
} from '@/hooks/queries/useIntegrationQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AwsSetupFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

export function AwsSetupForm({ onCreated, onCancel }: AwsSetupFormProps) {
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
          <TabsTrigger value="access_key" className="flex-1">
            Access Key
          </TabsTrigger>
          <TabsTrigger value="iam_role" className="flex-1">
            IAM Role
          </TabsTrigger>
        </TabsList>

        <TabsContent value="access_key" className="mt-4">
          <form onSubmit={handleAccessKeySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cloud-aws-display-name-key">Display Name *</Label>
              <Input
                id="cloud-aws-display-name-key"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Production AWS Account"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-aws-access-key-id">Access Key ID *</Label>
              <Input
                id="cloud-aws-access-key-id"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AKIA..."
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-aws-secret-access-key">Secret Access Key *</Label>
              <Input
                id="cloud-aws-secret-access-key"
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="••••••••"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-aws-session-token">Session Token</Label>
              <Input
                id="cloud-aws-session-token"
                type="password"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                placeholder="Optional"
                disabled={createAwsAccessKeyMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-aws-region-key">Region</Label>
              <Input
                id="cloud-aws-region-key"
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
                      Paste the JSON below as the trust policy.
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
                      <div className="px-3 pb-3 text-xs text-blue-700/80 dark:text-blue-300/80 space-y-2">
                        <p>
                          <strong>IAM Role assumption with an External ID</strong> is the
                          AWS-recommended approach for granting cross-account access.
                        </p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>
                            <strong>No long-lived credentials.</strong> Role assumption uses
                            temporary security tokens (STS) that expire automatically.
                          </li>
                          <li>
                            <strong>Scoped permissions.</strong> The IAM role defines exactly what
                            ShipSec can do. You control the permission boundary.
                          </li>
                          <li>
                            <strong>External ID prevents confused-deputy attacks.</strong> The
                            unique External ID ensures only your organization can assume this role.
                          </li>
                          <li>
                            <strong>Full audit trail.</strong> Every role assumption is logged in
                            AWS CloudTrail.
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
                      managed policies.
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
                              Read-only access to security configuration data.
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
                            account.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        <strong>Tip:</strong> In the AWS IAM console, search for each policy name in
                        the &ldquo;Add permissions &rarr; Attach policies directly&rdquo; step.
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
