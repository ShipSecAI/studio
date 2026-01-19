import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { RuntimeInputsEditor } from './RuntimeInputsEditor';
import { SimpleVariableListEditor } from './SimpleVariableListEditor';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import { FormFieldsEditor } from './FormFieldsEditor';
import { SelectionOptionsEditor } from './SelectionOptionsEditor';
import type { Parameter } from '@/schemas/component';
import type { InputMapping } from '@/schemas/node';
import { useSecretStore } from '@/store/secretStore';
import { useIntegrationStore } from '@/store/integrationStore';
import { getCurrentUserId } from '@/lib/currentUser';
import { useArtifactStore } from '@/store/artifactStore';
import { env } from '@/config/env';
import { api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Search } from 'lucide-react';
import type { ArtifactMetadata } from '@shipsec/shared';

interface ParameterFieldProps {
  parameter: Parameter;
  value: any;
  onChange: (value: any) => void;
  connectedInput?: InputMapping;
  componentId?: string;
  parameters?: Record<string, unknown> | undefined;
  onUpdateParameter?: (paramId: string, value: any) => void;
}

/**
 * ParameterField - Renders appropriate input field based on parameter type
 */
export function ParameterField({
  parameter,
  value,
  onChange,
  connectedInput,
  componentId,
  parameters,
  onUpdateParameter,
}: ParameterFieldProps) {
  const currentValue = value !== undefined ? value : parameter.default;
  const [jsonError, setJsonError] = useState<string | null>(null);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const secrets = useSecretStore((state) => state.secrets);
  const secretsLoading = useSecretStore((state) => state.loading);
  const secretsError = useSecretStore((state) => state.error);
  const fetchSecrets = useSecretStore((state) => state.fetchSecrets);
  const refreshSecrets = useSecretStore((state) => state.refresh);

  const integrationConnections = useIntegrationStore((state) => state.connections);
  const fetchIntegrationConnections = useIntegrationStore((state) => state.fetchConnections);
  const integrationLoading = useIntegrationStore((state) => state.loadingConnections);
  const integrationError = useIntegrationStore((state) => state.error);

  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const hasFetchedConnectionsRef = useRef(false);
  const autoSelectedConnectionRef = useRef(false);

  const authModeFromParameters: 'manual' | 'connection' = useMemo(() => {
    const map = parameters as Record<string, unknown> | undefined;
    if (map && typeof map.authMode === 'string') {
      return map.authMode as 'manual' | 'connection';
    }
    const connectionCandidate = map?.connectionId;
    if (typeof connectionCandidate === 'string' && connectionCandidate.trim().length > 0) {
      return 'connection';
    }
    return 'manual';
  }, [parameters]);

  const isRemoveGithubComponent = componentId === 'github.org.membership.remove';
  const isProviderGithubComponent = componentId === 'github.connection.provider';
  const isGitHubConnectionComponent = isRemoveGithubComponent || isProviderGithubComponent;
  const isConnectionSelector = isGitHubConnectionComponent && parameter.id === 'connectionId';
  const isGithubConnectionMode = isRemoveGithubComponent && authModeFromParameters === 'connection';

  const currentBuilderWorkflowId = useWorkflowStore((state) => state.metadata.id);
  const isWorkflowCallComponent = componentId === 'core.workflow.call';
  const isWorkflowSelector = isWorkflowCallComponent && parameter.id === 'workflowId';

  const githubConnections = useMemo(
    () => integrationConnections.filter((connection) => connection.provider === 'github'),
    [integrationConnections],
  );

  const [workflowOptions, setWorkflowOptions] = useState<{ id: string; name: string }[]>([]);
  const [workflowOptionsLoading, setWorkflowOptionsLoading] = useState(false);
  const [workflowOptionsError, setWorkflowOptionsError] = useState<string | null>(null);
  const [workflowPortSyncError, setWorkflowPortSyncError] = useState<string | null>(null);

  const selectedWorkflowId =
    typeof currentValue === 'string' && currentValue.trim().length > 0 ? currentValue.trim() : '';

  const syncCallWorkflowPorts = useCallback(
    async (workflowId: string) => {
      setWorkflowPortSyncError(null);
      try {
        const workflow = await api.workflows.get(workflowId);
        const graph = workflow.graph;
        const entrypoint = graph.nodes.find((node) => node.type === 'core.workflow.entrypoint');

        const runtimeInputsCandidate = entrypoint?.data?.config?.runtimeInputs;

        const runtimeInputs = Array.isArray(runtimeInputsCandidate) ? runtimeInputsCandidate : [];

        onUpdateParameter?.('childWorkflowName', workflow.name);
        onUpdateParameter?.('childRuntimeInputs', runtimeInputs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setWorkflowPortSyncError(message);
        onUpdateParameter?.('childRuntimeInputs', []);
      }
    },
    [onUpdateParameter],
  );

  useEffect(() => {
    if (!isWorkflowSelector) return;

    let cancelled = false;
    setWorkflowOptionsLoading(true);
    setWorkflowOptionsError(null);

    api.workflows
      .list()
      .then((workflows) => {
        if (cancelled) return;
        const options = workflows
          .filter((workflow) => workflow.id !== currentBuilderWorkflowId)
          .map((workflow) => ({ id: workflow.id, name: workflow.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setWorkflowOptions(options);
      })
      .catch((error) => {
        if (cancelled) return;
        setWorkflowOptionsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setWorkflowOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isWorkflowSelector, currentBuilderWorkflowId]);

  useEffect(() => {
    if (!isWorkflowSelector) return;
    if (!selectedWorkflowId) return;

    const existingRuntimeInputs = (parameters as any)?.childRuntimeInputs;
    const shouldSync = !Array.isArray(existingRuntimeInputs) || existingRuntimeInputs.length === 0;

    if (!shouldSync) return;
    void syncCallWorkflowPorts(selectedWorkflowId);
  }, [isWorkflowSelector, selectedWorkflowId, parameters, syncCallWorkflowPorts]);

  useEffect(() => {
    if (!isConnectionSelector) {
      return;
    }
    if (hasFetchedConnectionsRef.current) {
      return;
    }
    hasFetchedConnectionsRef.current = true;
    fetchIntegrationConnections(currentUserId).catch((error) => {
      console.error('Failed to load integration connections', error);
    });
  }, [isConnectionSelector, fetchIntegrationConnections, currentUserId]);

  useEffect(() => {
    if (!isConnectionSelector || integrationLoading) {
      return;
    }

    const selectedValue =
      typeof currentValue === 'string' && currentValue.trim().length > 0 ? currentValue.trim() : '';

    if (selectedValue) {
      autoSelectedConnectionRef.current = true;
      return;
    }

    if (githubConnections.length === 1 && !autoSelectedConnectionRef.current) {
      const [firstConnection] = githubConnections;
      if (firstConnection) {
        autoSelectedConnectionRef.current = true;
        onChange(firstConnection.id);
        if (isRemoveGithubComponent) {
          onUpdateParameter?.('authMode', 'connection');
          onUpdateParameter?.('clientId', undefined);
          onUpdateParameter?.('clientSecret', undefined);
        }
      }
    }
  }, [
    isConnectionSelector,
    githubConnections,
    integrationLoading,
    currentValue,
    onChange,
    onUpdateParameter,
    isRemoveGithubComponent,
  ]);

  const handleRefreshConnections = async () => {
    try {
      await fetchIntegrationConnections(currentUserId, true);
    } catch (error) {
      console.error('Failed to refresh integration connections', error);
    }
  };

  const isReceivingInput = Boolean(connectedInput);

  const [secretMode, setSecretMode] = useState<'select' | 'manual'>(() => {
    if (parameter.type !== 'secret') {
      return 'manual';
    }
    if (
      typeof currentValue === 'string' &&
      secrets.some((secret) => secret.id === currentValue || secret.name === currentValue)
    ) {
      return 'select';
    }
    return secrets.length > 0 ? 'select' : 'manual';
  });

  useEffect(() => {
    if (parameter.type !== 'secret') {
      return;
    }
    fetchSecrets().catch((error) => {
      console.error('Failed to load secrets', error);
    });
  }, [parameter.type, fetchSecrets]);

  useEffect(() => {
    if (parameter.type !== 'secret' || isReceivingInput) {
      return;
    }

    if (secrets.length === 0) {
      setSecretMode('manual');
      return;
    }

    if (
      secretMode === 'select' &&
      (typeof currentValue !== 'string' ||
        !secrets.some((secret) => secret.id === currentValue || secret.name === currentValue))
    ) {
      const firstSecret = secrets[0];
      if (firstSecret) {
        onChange(firstSecret.name);
      }
    }
  }, [parameter.type, secretMode, secrets, currentValue, onChange, isReceivingInput]);

  useEffect(() => {
    if (parameter.type !== 'secret') {
      return;
    }
    // Log connection status for debugging secret input flow
    console.debug(
      `[ParameterField] secret parameter "${parameter.id}" connection state:`,
      connectedInput ?? 'manual',
    );
  }, [parameter.type, parameter.id, connectedInput]);

  const updateSecretValue = (nextValue: any) => {
    if (isReceivingInput) {
      console.debug(
        `[ParameterField] manual update blocked for secret "${parameter.id}" while receiving from upstream.`,
        connectedInput,
      );
      return;
    }
    onChange(nextValue);
  };

  if (isWorkflowSelector) {
    const disabled = isReceivingInput || workflowOptionsLoading;

    return (
      <div className="space-y-2">
        <select
          id={parameter.id}
          value={selectedWorkflowId}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue || undefined);

            if (!nextValue) {
              onUpdateParameter?.('childRuntimeInputs', []);
              onUpdateParameter?.('childWorkflowName', undefined);
              return;
            }

            void syncCallWorkflowPorts(nextValue);
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          disabled={disabled}
        >
          <option value="">Select a workflow…</option>
          {workflowOptions.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>

        {workflowOptionsError && (
          <p className="text-xs text-destructive">
            Failed to load workflows: {workflowOptionsError}
          </p>
        )}
        {workflowPortSyncError && (
          <p className="text-xs text-destructive">
            Failed to load entrypoint inputs: {workflowPortSyncError}
          </p>
        )}

        {selectedWorkflowId && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Selecting a workflow syncs its entrypoint inputs into dynamic ports.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void syncCallWorkflowPorts(selectedWorkflowId)}
              disabled={disabled}
            >
              Refresh ports
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isConnectionSelector) {
    const selectedValue = typeof currentValue === 'string' ? currentValue : '';
    const disabled = isReceivingInput || integrationLoading;

    return (
      <div className="space-y-2">
        <select
          value={selectedValue}
          onChange={(event) => {
            autoSelectedConnectionRef.current = true;
            const nextValue = event.target.value;
            console.log('Selected GitHub connection ID:', nextValue);
            if (nextValue === '') {
              onChange(undefined);
              if (isRemoveGithubComponent) {
                onUpdateParameter?.('authMode', 'manual');
              }
            } else {
              onChange(nextValue);
              if (isRemoveGithubComponent) {
                onUpdateParameter?.('authMode', 'connection');
                onUpdateParameter?.('clientId', undefined);
                onUpdateParameter?.('clientSecret', undefined);
              }
            }
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          disabled={disabled}
        >
          <option value="">Select a GitHub connection…</option>
          {githubConnections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.providerName} · {connection.userId}
            </option>
          ))}
        </select>

        {integrationLoading && (
          <p className="text-xs text-muted-foreground">Loading connections…</p>
        )}

        {integrationError && <p className="text-xs text-destructive">{integrationError}</p>}

        {!integrationLoading && githubConnections.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No active GitHub connections yet. Connect GitHub from the Connections manager.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {env.VITE_ENABLE_CONNECTIONS && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigate('/integrations')}
              disabled={isReceivingInput}
            >
              Manage connections
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void handleRefreshConnections();
            }}
            disabled={integrationLoading || isReceivingInput}
          >
            {integrationLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
          {selectedValue && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(undefined);
                if (isRemoveGithubComponent) {
                  onUpdateParameter?.('authMode', 'manual');
                }
              }}
              disabled={isReceivingInput}
            >
              Clear selection
            </Button>
          )}
        </div>
      </div>
    );
  }

  switch (parameter.type) {
    case 'text': {
      const disableForGitHubConnection =
        isRemoveGithubComponent && parameter.id === 'clientId' && isGithubConnectionMode;

      const inputElement = (
        <Input
          id={parameter.id}
          type="text"
          placeholder={parameter.placeholder}
          value={currentValue || ''}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
          disabled={isReceivingInput || disableForGitHubConnection}
        />
      );

      if (disableForGitHubConnection) {
        return (
          <div className="space-y-2">
            {inputElement}
            <p className="text-xs text-muted-foreground">
              Using a stored GitHub connection, so the client ID is managed automatically.
            </p>
          </div>
        );
      }

      return inputElement;
    }

    case 'textarea': {
      const isExternalUpdateRef = useRef(false);

      // Sync external changes to textarea (e.g., workflow undo)
      useEffect(() => {
        if (textareaRef.current && textareaRef.current.value !== (currentValue || '')) {
          isExternalUpdateRef.current = true;
          textareaRef.current.value = currentValue || '';
          isExternalUpdateRef.current = false;
        }
      }, [currentValue]);

      // Sync to parent only on blur for native undo behavior
      const handleBlur = useCallback(() => {
        if (textareaRef.current) {
          onChange(textareaRef.current.value);
        }
      }, [onChange]);

      return (
        <textarea
          ref={textareaRef}
          id={parameter.id}
          placeholder={parameter.placeholder}
          defaultValue={currentValue || ''}
          onBlur={handleBlur}
          rows={parameter.rows || 3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono"
        />
      );
    }

    case 'number':
      return (
        <Input
          id={parameter.id}
          type="number"
          placeholder={parameter.placeholder}
          value={currentValue ?? ''}
          onChange={(e) => {
            const inputValue = e.target.value;
            if (inputValue === '') {
              onChange(undefined);
              return;
            }
            onChange(Number(inputValue));
          }}
          min={parameter.min}
          max={parameter.max}
          className="text-sm"
        />
      );

    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <label htmlFor={parameter.id} className="text-sm font-medium cursor-pointer select-none">
            {parameter.label}
          </label>
          <Switch
            id={parameter.id}
            checked={currentValue || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      );

    case 'select': {
      const isAuthModeField = isRemoveGithubComponent && parameter.id === 'authMode';

      return (
        <select
          id={parameter.id}
          value={currentValue || ''}
          onChange={(e) => {
            const nextValue = e.target.value;
            onChange(nextValue);

            if (isAuthModeField && nextValue === 'manual') {
              onUpdateParameter?.('connectionId', undefined);
            }
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          disabled={isReceivingInput && !isAuthModeField}
        >
          {!parameter.required && !parameter.default && (
            <option value="">Select an option...</option>
          )}
          {parameter.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    case 'multi-select': {
      const selectedValues = Array.isArray(currentValue) ? currentValue : [];
      return (
        <div className="space-y-2">
          {parameter.options?.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <div
                key={option.value}
                className="flex items-center gap-2 hover:bg-muted/50 p-2 rounded transition-colors"
              >
                <Checkbox
                  id={`${parameter.id}-${option.value}`}
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    const newValues = checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v) => v !== option.value);
                    onChange(newValues);
                  }}
                />
                <label
                  htmlFor={`${parameter.id}-${option.value}`}
                  className="text-sm select-none cursor-pointer flex-1"
                >
                  {option.label}
                </label>
              </div>
            );
          })}
          {selectedValues.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedValues.map((val) => {
                const option = parameter.options?.find((o) => o.value === val);
                return (
                  <Badge key={val} variant="secondary" className="text-xs">
                    {option?.label || val}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    case 'file':
      return (
        <div className="space-y-2">
          <Input
            id={parameter.id}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onChange(file.name);
              }
            }}
            className="text-sm"
          />
          {currentValue && (
            <div className="text-xs text-muted-foreground">
              Selected: <span className="font-mono">{currentValue}</span>
            </div>
          )}
        </div>
      );

    case 'artifact':
      return (
        <ArtifactSelector
          parameterId={parameter.id}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(nextValue) => onChange(nextValue)}
        />
      );

    case 'secret': {
      const hasSecrets = secrets.length > 0;
      const activeSecret = secrets.find((s) => s.id === currentValue || s.name === currentValue);

      const selectedSecretKey = activeSecret?.name ?? '';

      const manualValue = typeof currentValue === 'string' && !activeSecret ? currentValue : '';
      const disableForGithubConnection =
        isRemoveGithubComponent && parameter.id === 'clientSecret' && isGithubConnectionMode;

      const connectionLabel =
        connectedInput?.source && connectedInput?.output
          ? `${connectedInput.source}.${connectedInput.output}`
          : connectedInput?.source;

      const handleModeChange = (mode: 'select' | 'manual') => {
        if (disableForGithubConnection) {
          return;
        }
        if (isReceivingInput) {
          return;
        }
        if (mode === 'select') {
          if (!hasSecrets) {
            setSecretMode('manual');
            return;
          }
          const existing =
            secrets.find((s) => s.id === currentValue || s.name === currentValue) ?? secrets[0];
          setSecretMode('select');
          updateSecretValue(existing?.name ?? undefined);
          return;
        }

        setSecretMode('manual');
        if (selectedSecretKey) {
          updateSecretValue(undefined);
        }
      };

      return (
        <div className="space-y-3">
          {isReceivingInput && (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Receiving input from upstream node
              {connectionLabel ? ` (${connectionLabel})` : ''}. Disconnect the mapping to edit
              manually.
            </div>
          )}
          {disableForGithubConnection && (
            <p className="text-xs text-muted-foreground">
              Using a stored GitHub connection, so the OAuth client secret is managed automatically.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={secretMode === 'select' ? 'default' : 'outline'}
              onClick={() => handleModeChange('select')}
              disabled={!hasSecrets || isReceivingInput || disableForGithubConnection}
            >
              From store
            </Button>
            <Button
              type="button"
              size="sm"
              variant={secretMode === 'manual' ? 'default' : 'outline'}
              onClick={() => handleModeChange('manual')}
              disabled={isReceivingInput || disableForGithubConnection}
            >
              Manual ID
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  refreshSecrets().catch((error) => {
                    console.error('Failed to refresh secrets', error);
                  });
                }}
                disabled={secretsLoading || isReceivingInput || disableForGithubConnection}
              >
                {secretsLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => navigate('/secrets')}
                disabled={isReceivingInput || disableForGithubConnection}
              >
                Manage secrets
              </Button>
            </div>
          </div>

          {secretsError && <p className="text-xs text-destructive">{secretsError}</p>}

          {secretMode === 'select' && hasSecrets && (
            <select
              value={selectedSecretKey}
              onChange={(e) => {
                const nextValue = e.target.value;
                updateSecretValue(nextValue === '' ? undefined : nextValue);
              }}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background"
              disabled={isReceivingInput || disableForGithubConnection}
            >
              <option value="">Select a secret…</option>
              {secrets.map((secret) => (
                <option key={secret.id} value={secret.name}>
                  {secret.name}
                </option>
              ))}
            </select>
          )}

          {secretMode === 'select' && !hasSecrets && (
            <p className="text-xs text-muted-foreground">
              No stored secrets yet. Create one in the Secret Manager or switch to manual entry.
            </p>
          )}

          {secretMode === 'manual' && (
            <Input
              id={`${parameter.id}-manual`}
              type="text"
              placeholder="Paste secret ID…"
              value={manualValue}
              onChange={(e) => updateSecretValue(e.target.value)}
              className="text-sm"
              disabled={isReceivingInput || disableForGithubConnection}
            />
          )}

          {secretMode === 'select' && activeSecret && (
            <p className="text-xs text-muted-foreground">
              Reference: <span className="font-mono">{activeSecret.name}</span> (ID:{' '}
              {activeSecret.id.substring(0, 8)}...)
            </p>
          )}

          {secretsError && <p className="text-xs text-destructive">{secretsError}</p>}

          <p className="text-xs text-muted-foreground">
            Secrets are securely stored; only references are shared with components.
          </p>
        </div>
      );
    }

    case 'json': {
      const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);
      const isExternalJsonUpdateRef = useRef(false);

      // Sync external changes to JSON textarea
      useEffect(() => {
        if (!jsonTextareaRef.current) return;

        let textValue = '';
        let needsNormalization = false;

        if (value === undefined || value === null || value === '') {
          textValue = '';
        } else if (typeof value === 'string') {
          textValue = value;
        } else {
          // If Value is an object - normalize to string
          try {
            textValue = JSON.stringify(value, null, 2);
            needsNormalization = true;
          } catch (error) {
            console.error('Failed to serialize JSON parameter value', error);
            return;
          }
        }

        if (jsonTextareaRef.current.value !== textValue) {
          isExternalJsonUpdateRef.current = true;
          jsonTextareaRef.current.value = textValue;
          setJsonError(null);
          isExternalJsonUpdateRef.current = false;
        }

        // Normalize object values to string
        if (needsNormalization) {
          onChange(textValue);
        }
      }, [value, onChange]);

      // Sync to parent only on blur for native undo behavior
      const handleJsonBlur = useCallback(() => {
        if (!jsonTextareaRef.current) return;
        const nextValue = jsonTextareaRef.current.value;

        if (nextValue.trim() === '') {
          setJsonError(null);
          onChange(undefined);
          return;
        }

        try {
          JSON.parse(nextValue); // Validate JSON syntax
          setJsonError(null);
          onChange(nextValue); // Pass string, not parsed object
        } catch (_error) {
          setJsonError('Invalid JSON');
          // Keep showing error, don't update parent
        }
      }, [onChange]);

      return (
        <div className="space-y-2">
          <textarea
            ref={jsonTextareaRef}
            id={parameter.id}
            defaultValue={
              value === undefined || value === null || value === ''
                ? ''
                : typeof value === 'string'
                  ? value
                  : JSON.stringify(value, null, 2)
            }
            onBlur={handleJsonBlur}
            className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono"
            rows={parameter.rows || 4}
            placeholder={parameter.placeholder || '{\n  "key": "value"\n}'}
          />
          {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
        </div>
      );
    }

    default:
      return (
        <div className="text-xs text-muted-foreground italic">
          Unsupported parameter type: {parameter.type}
        </div>
      );
  }
}

function ArtifactSelector({
  parameterId,
  value,
  onChange,
}: {
  parameterId: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hasRequestedLibrary, setHasRequestedLibrary] = useState(false);
  const fetchLibrary = useArtifactStore((state) => state.fetchLibrary);
  const libraryLoading = useArtifactStore((state) => state.libraryLoading);
  const libraryError = useArtifactStore((state) => state.libraryError);
  const library = useArtifactStore((state) => state.library);
  const runArtifacts = useArtifactStore((state) => state.runArtifacts);

  useEffect(() => {
    if (pickerOpen && !hasRequestedLibrary) {
      setHasRequestedLibrary(true);
      void fetchLibrary();
    }
  }, [pickerOpen, hasRequestedLibrary, fetchLibrary]);

  const knownArtifacts = useMemo(() => {
    const map = new Map<string, ArtifactMetadata>();
    for (const artifact of library) {
      map.set(artifact.id, artifact);
    }
    Object.values(runArtifacts).forEach((entry) => {
      entry?.artifacts.forEach((artifact) => {
        if (!map.has(artifact.id)) {
          map.set(artifact.id, artifact);
        }
      });
    });
    return map;
  }, [library, runArtifacts]);

  const selectedArtifact = value ? (knownArtifacts.get(value) ?? null) : null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {selectedArtifact ? (
          <span>
            Selected artifact:{' '}
            <span className="font-medium text-foreground">{selectedArtifact.name}</span>{' '}
            <span className="font-mono text-[11px] text-muted-foreground">
              ({selectedArtifact.id})
            </span>
          </span>
        ) : value ? (
          <span>
            Artifact ID:{' '}
            <span className="font-mono text-[11px] text-muted-foreground">{value}</span> (not in
            cached list)
          </span>
        ) : (
          'No artifact selected.'
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={parameterId}
          type="text"
          value={value || ''}
          onChange={(e) => {
            const nextValue = e.target.value.trim();
            onChange(nextValue.length > 0 ? nextValue : undefined);
          }}
          placeholder="Artifact ID (e.g. 123e4567-e89b-12d3-a456-426614174000)"
          className="text-sm"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setPickerOpen(true)}
          >
            Browse…
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              className="flex-1 sm:flex-none"
              onClick={() => onChange(undefined)}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <ArtifactPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(artifactId) => {
          onChange(artifactId);
          setPickerOpen(false);
        }}
        libraryLoading={libraryLoading}
        libraryError={libraryError}
        artifacts={library}
        onRefresh={fetchLibrary}
      />
    </div>
  );
}

function ArtifactPickerDialog({
  open,
  onOpenChange,
  onSelect,
  libraryLoading,
  libraryError,
  artifacts,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (artifactId: string) => void;
  libraryLoading: boolean;
  libraryError: string | null;
  artifacts: ArtifactMetadata[];
  onRefresh: () => Promise<void>;
}) {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
    }
  }, [open]);

  const filteredArtifacts = useMemo(() => {
    if (!searchTerm.trim()) {
      return artifacts;
    }
    const term = searchTerm.toLowerCase();
    return artifacts.filter((artifact) => {
      return (
        artifact.name.toLowerCase().includes(term) ||
        artifact.componentRef.toLowerCase().includes(term) ||
        artifact.id.toLowerCase().includes(term)
      );
    });
  }, [artifacts, searchTerm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select an artifact</DialogTitle>
          <DialogDescription>
            Choose an artifact from the workspace library. Only artifacts saved to the library are
            listed here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name, component, or ID"
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={libraryLoading}
              onClick={() => void onRefresh()}
            >
              Refresh
            </Button>
          </div>
          {libraryError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {libraryError}
            </div>
          )}
          <div className="max-h-[320px] overflow-auto rounded-md border">
            {libraryLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Loading artifacts…
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No artifacts found. Try refreshing or adjusting your search.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Component</th>
                    <th className="px-3 py-2 font-medium">Destinations</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtifacts.map((artifact) => (
                    <tr key={artifact.id} className="border-t">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{artifact.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[260px]">
                          {artifact.id}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {artifact.componentRef}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {artifact.destinations.map((destination) => (
                            <Badge
                              key={`${artifact.id}-${destination}`}
                              variant="outline"
                              className="text-[10px] uppercase"
                            >
                              {destination}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Button type="button" size="sm" onClick={() => onSelect(artifact.id)}>
                          Use
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
interface ParameterFieldWrapperProps {
  parameter: Parameter;
  value: any;
  onChange: (value: any) => void;
  connectedInput?: InputMapping;
  componentId?: string;
  parameters?: Record<string, unknown> | undefined;
  onUpdateParameter?: (paramId: string, value: any) => void;
  allComponentParameters?: Parameter[];
}

/**
 * Checks if a parameter should be visible based on its visibleWhen conditions.
 * Returns true if all conditions are met or if no conditions exist.
 */
function shouldShowParameter(
  parameter: Parameter,
  allParameters: Record<string, unknown> | undefined,
): boolean {
  // If no visibleWhen conditions, always show
  if (!parameter.visibleWhen) {
    return true;
  }

  // If we have conditions but no parameter values to check against, hide by default
  if (!allParameters) {
    return false;
  }

  // Check all conditions in visibleWhen object
  for (const [key, expectedValue] of Object.entries(parameter.visibleWhen)) {
    const actualValue = allParameters[key];
    if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a boolean parameter acts as a header toggle (controls visibility of other params).
 * Returns true if other parameters have visibleWhen conditions referencing this parameter.
 */
function isHeaderToggleParameter(
  parameter: Parameter,
  allComponentParameters: Parameter[] | undefined,
): boolean {
  if (parameter.type !== 'boolean' || !allComponentParameters) return false;

  // Check if any other parameter has visibleWhen referencing this param
  return allComponentParameters.some((p) => p.visibleWhen && parameter.id in p.visibleWhen);
}

/**
 * ParameterFieldWrapper - Wraps parameter field with label and description
 */
export function ParameterFieldWrapper({
  parameter,
  value,
  onChange,
  connectedInput,
  componentId,
  parameters,
  onUpdateParameter,
  allComponentParameters,
}: ParameterFieldWrapperProps) {
  // Check visibility conditions
  if (!shouldShowParameter(parameter, parameters)) {
    return null;
  }

  // Special case: Runtime Inputs Editor for Entry Point
  if (parameter.id === 'runtimeInputs') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <RuntimeInputsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Variable list editor (Logic Script, Slack, Manual Actions, etc.)
  if (parameter.type === 'variable-list') {
    const isInput = parameter.id === 'variables';
    const title = parameter.label || (isInput ? 'Input Variables' : 'Return Variables');

    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <SimpleVariableListEditor
          value={value || []}
          onChange={onChange}
          title={title}
          type={isInput ? 'input' : 'output'}
        />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Form Fields Designer
  if (parameter.type === 'form-fields') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <FormFieldsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Selection Options Editor
  if (parameter.type === 'selection-options') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <SelectionOptionsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Logic Script Code Editor
  if (componentId === 'core.logic.script' && parameter.id === 'code') {
    const inputVariables = Array.isArray(parameters?.variables)
      ? (parameters.variables as { name: string; type: string }[])
      : [];
    const outputVariables = Array.isArray(parameters?.returns)
      ? (parameters.returns as { name: string; type: string }[])
      : [];

    return (
      <ScriptCodeEditor
        code={value || ''}
        onCodeChange={onChange}
        inputVariables={inputVariables}
        outputVariables={outputVariables}
      />
    );
  }

  // Check if this is a nested/conditional parameter (has visibleWhen)
  const isNestedParameter = Boolean(parameter.visibleWhen);

  // Check if this is a header toggle (boolean that controls other params' visibility)
  const isHeaderToggle = isHeaderToggleParameter(parameter, allComponentParameters);

  // Header toggle rendering
  if (isHeaderToggle) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" htmlFor={parameter.id}>
            {parameter.label}
          </label>
          <Switch
            id={parameter.id}
            checked={value || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
        {parameter.description && (
          <p className="text-xs text-muted-foreground">{parameter.description}</p>
        )}
      </div>
    );
  }

  // Standard parameter field rendering
  const isBooleanParameter = parameter.type === 'boolean';

  return (
    <div
      className={`space-y-2 ${isNestedParameter ? 'ml-2 px-3 py-2.5 mt-1 bg-muted/80 rounded-lg' : ''}`}
    >
      {/* Label and required indicator - skip for boolean (label is inside) */}
      {!isBooleanParameter && (
        <div className="flex items-center justify-between mb-1">
          <label
            className={`${isNestedParameter ? 'text-xs' : 'text-sm'} font-medium`}
            htmlFor={parameter.id}
          >
            {parameter.label}
          </label>
          {parameter.required && <span className="text-xs text-red-500">*required</span>}
        </div>
      )}

      {/* Description before the input field - for non-boolean parameters */}
      {!isBooleanParameter && parameter.description && (
        <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
      )}

      <ParameterField
        parameter={parameter}
        value={value}
        onChange={onChange}
        connectedInput={connectedInput}
        componentId={componentId}
        parameters={parameters}
        onUpdateParameter={onUpdateParameter}
      />

      {/* Description after field (toggle control) - for boolean parameters */}
      {isBooleanParameter && parameter.description && (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      )}

      {parameter.helpText && (
        <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
      )}
    </div>
  );
}
