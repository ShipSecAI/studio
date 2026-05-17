import { useState } from 'react';
import { Loader2, Shield, Copy, Check, Eye } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
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
import {
  ChevronRight,
  SetupErrorState,
  SetupLoadingState,
  SetupPermissionCard,
  SetupResultAlert,
  SetupStepIndicator,
  SetupTip,
  SetupWhyDisclosure,
  type SetupResult,
} from './SetupFormShared';

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
  const [result, setResult] = useState<SetupResult | null>(null);
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

            <SetupResultAlert result={result} />

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
            <SetupLoadingState label="Loading setup info..." />
          ) : !setupInfo ? (
            <SetupErrorState
              message={setupError}
              errorFallback="Failed to load AWS IAM role setup info."
              note="Access Key remains available for the community edition path."
            />
          ) : (
            <div className="space-y-4">
              <SetupStepIndicator
                step={step}
                steps={['Configure Trust Policy', 'Attach Permissions', 'Connection Details']}
                onStepChange={(nextStep) => {
                  setStep(nextStep as 1 | 2 | 3);
                  setResult(null);
                }}
              />

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
                  <SetupWhyDisclosure
                    open={whyOpen}
                    title="Why IAM Role assumption instead of access keys?"
                    onOpenChange={setWhyOpen}
                  >
                    <p>
                      <strong>IAM Role assumption with an External ID</strong> is the
                      AWS-recommended approach for granting cross-account access.
                    </p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>
                        <strong>No long-lived credentials.</strong> Role assumption uses temporary
                        security tokens (STS) that expire automatically.
                      </li>
                      <li>
                        <strong>Scoped permissions.</strong> The IAM role defines exactly what
                        ShipSec can do. You control the permission boundary.
                      </li>
                      <li>
                        <strong>External ID prevents confused-deputy attacks.</strong> The unique
                        External ID ensures only your organization can assume this role.
                      </li>
                      <li>
                        <strong>Full audit trail.</strong> Every role assumption is logged in AWS
                        CloudTrail.
                      </li>
                    </ul>
                  </SetupWhyDisclosure>

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
                        <SetupPermissionCard
                          icon={<Shield className="h-3 w-3" />}
                          title="SecurityAudit"
                          description="Read-only access to security configuration data."
                        />
                        <SetupPermissionCard
                          icon={<Eye className="h-3 w-3" />}
                          title="ViewOnlyAccess"
                          description="Read-only access to list and describe resources across AWS services."
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        For Organizations (management account only)
                      </p>
                      <SetupPermissionCard
                        icon={<Shield className="h-3 w-3" />}
                        title="OrganizationsReadOnlyAccess"
                        description="Read-only access to AWS Organizations. Only needed on the management account."
                      />
                    </div>

                    <SetupTip>
                      <strong>Tip:</strong> In the AWS IAM console, search for each policy name in
                      the &ldquo;Add permissions &rarr; Attach policies directly&rdquo; step.
                    </SetupTip>
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

                  <SetupResultAlert result={result} />

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
