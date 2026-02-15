import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, Loader2, X, Plus } from 'lucide-react';
import { useTriggerRules, useUpdateTriggerRule } from '@/hooks/queries/useGithubQueries';
import { api } from '@/services/api';

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
}

const PR_ACTIONS = ['opened', 'synchronize', 'reopened', 'closed'];
type TriggerEvent = 'pull_request' | 'push' | 'repository_added';

export default function EditTriggerRulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: triggerRules = [] } = useTriggerRules();
  const { mutateAsync: updateTriggerRule } = useUpdateTriggerRule();

  // Loading state
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repositoryPattern, setRepositoryPattern] = useState('');
  const [event, setEvent] = useState<TriggerEvent>('pull_request');
  const [actions, setActions] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchInput, setBranchInput] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [postPrComment, setPostPrComment] = useState(true);
  const [postPrReview, setPostPrReview] = useState(false);
  const [createCheckRun, setCreateCheckRun] = useState(true);
  const [failOn, setFailOn] = useState('high');
  const [enabled, setEnabled] = useState(true);

  // Workflows
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);

  // Submit state
  const [submitting, setSubmitting] = useState(false);

  // Fetch workflows on mount
  useEffect(() => {
    async function loadData() {
      try {
        const list = await api.workflows.list();
        setWorkflows(list.map((w) => ({ id: w.id, name: w.name, description: w.description })));
        setWorkflowsLoading(false);
      } catch {
        toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
      }
    }
    loadData();
  }, [toast]);

  // Load rule data when triggerRules updates
  useEffect(() => {
    if (!id) return;

    const foundRule = triggerRules.find((r) => r.id === id);
    if (foundRule) {
      setName(foundRule.name);
      setDescription(foundRule.description || '');
      setRepositoryPattern(foundRule.repositoryPattern);
      setEvent(foundRule.event as TriggerEvent);
      setActions(foundRule.actions);
      setBranches(foundRule.branches);
      setWorkflowId(foundRule.workflowId);
      setPostPrComment(foundRule.postPrComment);
      setPostPrReview(foundRule.postPrReview ?? false);
      setCreateCheckRun(foundRule.createCheckRun);
      setFailOn(foundRule.failOn || 'high');
      setEnabled(foundRule.enabled);
      setLoading(false);
    } else if (triggerRules.length > 0) {
      // Rules loaded but rule not found
      toast({ title: 'Error', description: 'Trigger rule not found', variant: 'destructive' });
      navigate('/integrations/github?tab=triggers');
    }
  }, [id, triggerRules, toast, navigate]);

  const handleActionToggle = (action: string) => {
    setActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action],
    );
  };

  const handleAddBranch = () => {
    const trimmed = branchInput.trim();
    if (trimmed && !branches.includes(trimmed)) {
      setBranches((prev) => [...prev, trimmed]);
      setBranchInput('');
    }
  };

  const handleRemoveBranch = (branch: string) => {
    setBranches((prev) => prev.filter((b) => b !== branch));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!id) return;

    // Validation
    if (!name.trim()) {
      toast({ title: 'Validation Error', description: 'Name is required', variant: 'destructive' });
      return;
    }
    if (!repositoryPattern.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Repository pattern is required',
        variant: 'destructive',
      });
      return;
    }
    if (!workflowId) {
      toast({
        title: 'Validation Error',
        description: 'Workflow is required',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      await updateTriggerRule({
        id,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          repositoryPattern: repositoryPattern.trim(),
          event,
          actions: event === 'pull_request' ? actions : undefined,
          branches:
            event === 'repository_added' ? undefined : branches.length > 0 ? branches : undefined,
          workflowId,
          postPrComment,
          postPrReview: event === 'pull_request' ? postPrReview : false,
          createCheckRun,
          failOn: createCheckRun ? failOn : undefined,
          enabled,
        },
      });
      toast({ title: 'Success', description: 'Trigger rule updated' });
      navigate('/integrations/github?tab=triggers');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update trigger rule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="mb-6">
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent className="space-y-6">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/integrations/github?tab=triggers')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to GitHub
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Trigger Rule</CardTitle>
          <CardDescription>Update the configuration for this trigger rule.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
              <section className="space-y-6 rounded-lg border p-5">
                <div>
                  <h3 className="text-sm font-semibold">Rule Scope</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Define when this trigger should run.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Scan all PRs"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description of what this rule does"
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repositoryPattern">Repository Pattern *</Label>
                  <Input
                    id="repositoryPattern"
                    value={repositoryPattern}
                    onChange={(e) => setRepositoryPattern(e.target.value)}
                    placeholder="e.g., org/repo, org/*, or *"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use <code>org/repo</code> for exact match, <code>org/*</code> for all repos in
                    an org, or <code>*</code> for all repositories.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event">Event *</Label>
                  <Select value={event} onValueChange={(v) => setEvent(v as TriggerEvent)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pull_request">Pull Request</SelectItem>
                      <SelectItem value="push">Push</SelectItem>
                      <SelectItem value="repository_added">Repository Added</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {event === 'pull_request' && (
                  <div className="space-y-2">
                    <Label>PR Actions</Label>
                    <div className="flex flex-wrap gap-2">
                      {PR_ACTIONS.map((action) => (
                        <Badge
                          key={action}
                          variant={actions.includes(action) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => handleActionToggle(action)}
                        >
                          {action}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Select which PR actions should trigger this rule.
                    </p>
                  </div>
                )}

                {event !== 'repository_added' && (
                  <div className="space-y-2">
                    <Label>Branch Patterns</Label>
                    <div className="flex gap-2">
                      <Input
                        value={branchInput}
                        onChange={(e) => setBranchInput(e.target.value)}
                        placeholder="e.g., main, release/*"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddBranch();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={handleAddBranch}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {branches.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {branches.map((branch) => (
                          <Badge key={branch} variant="secondary" className="pr-1">
                            {branch}
                            <button
                              type="button"
                              onClick={() => handleRemoveBranch(branch)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Leave empty to match all branches. Use <code>release/*</code> for wildcard
                      patterns.
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-4 rounded-lg border p-5 xl:sticky xl:top-6">
                <div>
                  <h3 className="text-sm font-semibold">Scan Behavior</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Choose which workflow runs and how results are published.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workflow">Workflow *</Label>
                  <Select
                    value={workflowId}
                    onValueChange={setWorkflowId}
                    disabled={workflowsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          workflowsLoading ? 'Loading workflows...' : 'Select a workflow'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="postPrComment"
                      checked={postPrComment}
                      onCheckedChange={(checked) => setPostPrComment(checked === true)}
                    />
                    <Label htmlFor="postPrComment" className="font-normal cursor-pointer">
                      Post PR comment with results
                    </Label>
                  </div>
                  {event === 'pull_request' && (
                    <div className="ml-6 space-y-1">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="postPrReview"
                          checked={postPrReview}
                          onCheckedChange={(checked) => setPostPrReview(checked === true)}
                        />
                        <Label htmlFor="postPrReview" className="font-normal cursor-pointer">
                          Post inline review comments on changed lines
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Findings on changed lines appear as review comments in the Files Changed
                        tab.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="createCheckRun"
                      checked={createCheckRun}
                      onCheckedChange={(checked) => setCreateCheckRun(checked === true)}
                    />
                    <Label htmlFor="createCheckRun" className="font-normal cursor-pointer">
                      Create GitHub Check Run
                    </Label>
                  </div>
                  {createCheckRun && (
                    <div className="ml-6 space-y-2">
                      <Label htmlFor="failOn">Fail check when severity is</Label>
                      <Select value={failOn} onValueChange={setFailOn}>
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">Critical only</SelectItem>
                          <SelectItem value="high">High and above</SelectItem>
                          <SelectItem value="medium">Medium and above</SelectItem>
                          <SelectItem value="low">Low and above</SelectItem>
                          <SelectItem value="info">Info and above</SelectItem>
                          <SelectItem value="none">Never fail</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        The check run will report failure when findings at or above this severity
                        are found.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enabled"
                      checked={enabled}
                      onCheckedChange={(checked) => setEnabled(checked === true)}
                    />
                    <Label htmlFor="enabled" className="font-normal cursor-pointer">
                      Enabled
                    </Label>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex gap-4 border-t pt-4">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/integrations/github?tab=triggers')}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
