import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  History as LucideHistory,
  Settings,
  Copy,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Code,
} from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import Editor, { loader } from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { SaveButton } from '@/components/ui/save-button';
import type {
  WebhookConfiguration,
  WebhookDelivery,
  WebhookInputDefinition,
} from '@shipsec/shared';

// Configure Monaco
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' } });

interface WebhookFormState {
  workflowId: string;
  name: string;
  description: string;
  parsingScript: string;
  expectedInputs: WebhookInputDefinition[];
}

const DEFAULT_PARSING_SCRIPT = `// Transform the incoming webhook payload into workflow inputs
export async function script(input: {
  payload: any
  headers: Record<string, string>
}): Promise<Record<string, any>> {
  // Extract data from the payload and return as key-value pairs
  return {
    // Example: input.payload.data
  }
}`;

export function WebhookEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === 'new';

  // Get returnTo state for back button (if navigated from workflow webhooks sidebar)
  const navigationState = location.state as {
    returnTo?: { path: string; openWebhooksSidebar?: boolean };
  } | null;
  const returnToPath = navigationState?.returnTo?.path;
  const openWebhooksSidebarOnReturn = navigationState?.returnTo?.openWebhooksSidebar;

  // Derive active tab from URL
  const activeTab = useMemo(() => {
    if (location.pathname.endsWith('/deliveries')) return 'deliveries';
    if (location.pathname.endsWith('/settings')) return 'settings';
    return 'editor';
  }, [location.pathname]);

  const navigateToTab = (tab: string) => {
    if (isNew) return; // Don't navigate for new webhooks
    const basePath = `/webhooks/${id}`;
    if (tab === 'editor') {
      navigate(basePath);
    } else {
      navigate(`${basePath}/${tab}`);
    }
  };

  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [webhook, setWebhook] = useState<WebhookConfiguration | null>(null);

  // Form State
  const [form, setForm] = useState<WebhookFormState>({
    workflowId: '',
    name: 'New Webhook',
    description: '',
    parsingScript: DEFAULT_PARSING_SCRIPT,
    expectedInputs: [],
  });

  const [initialForm, setInitialForm] = useState<WebhookFormState | null>(
    isNew
      ? {
          workflowId: '',
          name: 'New Webhook',
          description: '',
          parsingScript: DEFAULT_PARSING_SCRIPT,
          expectedInputs: [],
        }
      : null,
  );

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    try {
      return JSON.stringify(form) !== JSON.stringify(initialForm);
    } catch (_e) {
      return true;
    }
  }, [form, initialForm]);

  // Test State
  const [testPayload, setTestPayload] = useState('{\n  "message": "Hello World"\n}');
  const [testHeaders, setTestHeaders] = useState('{\n  "content-type": "application/json"\n}');
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Resources
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [workflowRuntimeInputs, setWorkflowRuntimeInputs] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [isLoadingDeliveries, setIsLoadingDeliveries] = useState(false);

  // Load Initial Data
  useEffect(() => {
    const loadResources = async () => {
      try {
        if (!isNew) setIsLoading(true);

        const workflowsList = await api.workflows.list();
        setWorkflows(workflowsList.map((w) => ({ id: w.id, name: w.name })));

        if (isNew) {
          const defaultState = {
            workflowId: '',
            name: 'New Webhook',
            description: '',
            parsingScript: DEFAULT_PARSING_SCRIPT,
            expectedInputs: [],
          };
          setForm(defaultState);
          setInitialForm(defaultState);
        } else if (id) {
          const loadedWebhook = (await api.webhooks.get(id)) as unknown as WebhookConfiguration;
          setWebhook(loadedWebhook);
          const loadedForm = {
            workflowId: loadedWebhook.workflowId,
            name: loadedWebhook.name,
            description: loadedWebhook.description || '',
            parsingScript: loadedWebhook.parsingScript,
            expectedInputs: loadedWebhook.expectedInputs,
          };
          setForm(loadedForm);
          setInitialForm(loadedForm);
        }
      } catch (error) {
        toast({
          title: 'Error loading data',
          description: String(error),
          variant: 'destructive',
        });
        if (!isNew) navigate('/webhooks');
      } finally {
        setIsLoading(false);
      }
    };
    loadResources();
  }, [id, isNew, navigate, toast]);

  // Load Workflow Runtime Inputs and sync to expectedInputs
  useEffect(() => {
    if (!form.workflowId) return;

    api.workflows
      .getRuntimeInputs(form.workflowId)
      .then((res) => {
        const runtimeInputs = res.inputs || [];
        setWorkflowRuntimeInputs(runtimeInputs);

        // Automatically populate expectedInputs from workflow runtime inputs
        // This ensures the backend validation passes
        const mappedInputs: WebhookInputDefinition[] = runtimeInputs.map((input: any) => ({
          id: input.id,
          label: input.label || input.id,
          type: (input.type === 'string' ? 'text' : input.type) || 'text',
          required: input.required !== false,
          description: input.description || '',
        }));
        setForm((prev) => ({ ...prev, expectedInputs: mappedInputs }));
      })
      .catch(console.error);
  }, [form.workflowId]);

  // Load Deliveries
  useEffect(() => {
    if (isNew || !id) return;
    setIsLoadingDeliveries(true);
    api.webhooks
      .listDeliveries(id)
      .then((data) => setDeliveries(data || []))
      .catch(console.error)
      .finally(() => setIsLoadingDeliveries(false));
  }, [id, isNew]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        expectedInputs: form.expectedInputs, // simplified for now
      };

      if (isNew) {
        const created = (await api.webhooks.create(payload)) as any;
        toast({ title: 'Webhook created' });
        setInitialForm(payload);
        navigate(`/webhooks/${created.id}`, { replace: true });
      } else {
        await api.webhooks.update(id!, payload);
        setInitialForm(payload);
        toast({ title: 'Webhook saved' });
      }
    } catch (error) {
      toast({
        title: 'Save failed',
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // Only save if action is valid (dirty or new) and not saving
        const canSave = (isDirty || isNew) && !isSaving;
        if (canSave) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isDirty, isNew, isSaving]);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const payloadObj = JSON.parse(testPayload);
      const headersObj = JSON.parse(testHeaders);

      const result = await api.webhooks.testScript({
        script: form.parsingScript,
        payload: payloadObj,
        headers: headersObj,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ error: String(error) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;
    try {
      await api.webhooks.delete(id!);
      navigate('/webhooks');
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: String(error),
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background no-scrollbar overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'h-[56px] md:h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
          'flex items-center justify-between px-3 md:px-4 gap-2 md:gap-4 shrink-0 z-10',
        )}
      >
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (returnToPath) {
                // Navigate back to workflow with query param to re-open sidebar
                const url = openWebhooksSidebarOnReturn
                  ? `${returnToPath}?openWebhooksSidebar=true`
                  : returnToPath;
                navigate(url);
              } else {
                navigate('/webhooks');
              }
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="h-7 text-lg font-semibold border-transparent hover:border-input focus:border-input px-1 w-[300px]"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {webhook?.webhookPath ? (
                <div className="flex items-center gap-1.5">
                  <code className="bg-muted px-1 rounded">{webhook.webhookPath}</code>
                  <Copy
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => {
                      // Logic to get full URL would go here, maybe api.webhooks.getUrl needed
                      navigator.clipboard.writeText(window.location.host + webhook.webhookPath);
                      toast({ title: 'Copied path' });
                    }}
                  />
                </div>
              ) : (
                'Unsaved Configuration'
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SaveButton
            onClick={handleSave}
            isSaving={isSaving}
            isDirty={isDirty || isNew}
            label={isNew ? 'Create' : undefined}
          />
          {!isNew && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={navigateToTab} className="h-full flex flex-col">
          <div className="px-6 py-2 border-b bg-muted/40 shrink-0">
            <TabsList>
              <TabsTrigger value="editor" className="gap-2">
                <Code className="h-4 w-4" /> Editor & Test
              </TabsTrigger>
              <TabsTrigger value="deliveries" className="gap-2" disabled={isNew}>
                <LucideHistory className="h-4 w-4" /> Deliveries
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2" disabled={isNew}>
                <Settings className="h-4 w-4" /> Settings
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="editor" className="flex-1 overflow-hidden m-0 p-0 h-full">
            <div className="grid grid-cols-2 h-full divide-x">
              {/* Left Pane: Configuration */}
              <div className="flex flex-col h-full overflow-y-auto p-6 space-y-6">
                {/* Workflow Selection */}
                <div className="space-y-2">
                  <Label>Trigger Workflow</Label>
                  <Select
                    value={form.workflowId}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, workflowId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a workflow..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    The workflow to trigger when this webhook receives an event.
                  </p>
                </div>

                {/* Parsing Script */}
                <div className="space-y-2 flex-1 flex flex-col min-h-[400px]">
                  <div className="flex items-center justify-between">
                    <Label>Parsing Script</Label>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      TypeScript
                    </Badge>
                  </div>
                  <div className="flex-1 border rounded-md overflow-hidden min-h-[300px]">
                    <Editor
                      language="typescript"
                      value={form.parsingScript}
                      onChange={(v) => setForm((prev) => ({ ...prev, parsingScript: v || '' }))}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        padding: { top: 12, bottom: 12 },
                      }}
                    />
                  </div>
                </div>

                {/* Expected Inputs */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Expected Output (Workflow Inputs)</Label>
                    <Badge variant="outline">{workflowRuntimeInputs.length} Inputs</Badge>
                  </div>
                  <div className="space-y-2">
                    {workflowRuntimeInputs.map((input) => (
                      <div
                        key={input.id}
                        className="flex items-center justify-between p-3 border rounded-md bg-muted/50"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{input.label}</span>
                          <code className="text-xs text-muted-foreground">{input.id}</code>
                        </div>
                        <Badge
                          variant={input.required ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {input.type}
                        </Badge>
                      </div>
                    ))}
                    {workflowRuntimeInputs.length === 0 && (
                      <div className="text-sm text-muted-foreground italic text-center py-4">
                        Associate a workflow with an Entry Point to see required inputs.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Pane: Testing */}
              <div className="flex flex-col h-full overflow-hidden bg-muted/10">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <h3 className="font-medium flex items-center gap-2">
                    <Play className="h-4 w-4 text-emerald-500" /> Test Console
                  </h3>
                  <Button size="sm" onClick={handleTest} disabled={isTesting}>
                    {isTesting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Run Test
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Test Inputs */}
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>Test Payload (JSON)</Label>
                      <div className="h-[200px] border rounded-md overflow-hidden">
                        <Editor
                          language="json"
                          value={testPayload}
                          onChange={(v) => setTestPayload(v || '')}
                          theme="vs-dark"
                          options={{ minimap: { enabled: false }, fontSize: 12 }}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Test Headers (JSON)</Label>
                      <div className="h-[100px] border rounded-md overflow-hidden">
                        <Editor
                          language="json"
                          value={testHeaders}
                          onChange={(v) => setTestHeaders(v || '')}
                          theme="vs-dark"
                          options={{ minimap: { enabled: false }, fontSize: 12 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Test Result */}
                  <div className="h-px bg-border my-4" />
                  <div className="space-y-2">
                    <Label>Result</Label>
                    <div className="min-h-[200px] p-4 border rounded-md bg-muted/30 font-mono text-xs overflow-auto">
                      {testResult ? (
                        testResult.error ? (
                          <div className="text-destructive whitespace-pre-wrap">
                            {testResult.error}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div
                              className={cn(
                                'flex items-center gap-2 font-medium pb-2 border-b',
                                testResult.success ? 'text-emerald-600' : 'text-destructive',
                              )}
                            >
                              {testResult.success ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <AlertTriangle className="h-4 w-4" />
                              )}
                              {testResult.success ? 'Successfully Parsed' : 'Parsing Failed'}
                            </div>
                            <pre>{JSON.stringify(testResult, null, 2)}</pre>

                            {/* Validation against workflow inputs */}
                            <div className="pt-4 border-t mt-4">
                              <span className="text-muted-foreground mb-2 block font-sans">
                                Workflow Input Matching:
                              </span>
                              {testResult.errorMessage && (
                                <div className="text-destructive text-xs mb-4 p-2 bg-destructive/10 rounded">
                                  Error: {testResult.errorMessage}
                                </div>
                              )}
                              {workflowRuntimeInputs.map((input) => {
                                const value = testResult.parsedData?.[input.id];
                                const isMissing = input.required && value === undefined;
                                return (
                                  <div
                                    key={input.id}
                                    className={cn(
                                      'flex items-center gap-2 py-1',
                                      isMissing ? 'text-destructive' : 'text-foreground',
                                    )}
                                  >
                                    {isMissing ? (
                                      <AlertTriangle className="h-3 w-3" />
                                    ) : (
                                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                    )}
                                    <span>
                                      {input.id}:{' '}
                                      {value !== undefined
                                        ? typeof value === 'object'
                                          ? JSON.stringify(value)
                                          : String(value)
                                        : 'undefined'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="text-muted-foreground flex items-center justify-center h-full">
                          Run a test to see results
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="deliveries" className="flex-1 overflow-auto p-6 m-0">
            {isLoadingDeliveries ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : deliveries.length > 0 ? (
              <div className="border rounded-md">
                <div className="grid grid-cols-4 gap-4 p-4 border-b bg-muted/40 font-medium text-sm">
                  <div>Status</div>
                  <div>Run ID</div>
                  <div>Timestamp</div>
                  <div className="text-right">Action</div>
                </div>
                {deliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className="grid grid-cols-4 gap-4 p-4 border-b last:border-0 items-center text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {delivery.status === 'delivered' ? (
                        <Badge className="bg-emerald-500 hover:bg-emerald-600">Success</Badge>
                      ) : (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs">{delivery.workflowRunId || '-'}</div>
                    <div className="text-muted-foreground">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </div>
                    <div className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/runs/${delivery.workflowRunId}`)}
                        disabled={!delivery.workflowRunId}
                      >
                        View Run
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4 py-12">
                <LucideHistory className="h-12 w-12 opacity-20" />
                <p>No deliveries found for this webhook.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="settings" className="flex-1 overflow-auto p-6 m-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Configure basic webhook details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Destructive actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" onClick={handleDelete} className="gap-2">
                  <Trash2 className="h-4 w-4" /> Delete Webhook
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
