import * as LucideIcons from 'lucide-react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  X,
  ExternalLink,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Circle,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Check,
  Globe,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownView } from '@/components/ui/markdown';
import { DynamicArtifactNameInput } from '@/components/workflow/DynamicArtifactNameInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useComponentStore } from '@/store/componentStore';
import { ParameterFieldWrapper } from './ParameterField';
import { WebhookDetails } from './WebhookDetails';
import { SecretSelect } from '@/components/inputs/SecretSelect';
// TODO: McpLibraryToolSelector will be integrated in a future PR
// import { McpLibraryToolSelector } from './McpLibraryToolSelector'
import type { Node } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentType, KeyboardEvent } from 'react';
import { useReactFlow } from 'reactflow';
import {
  describePortType,
  inputSupportsManualValue,
  isCredentialInput,
  isListOfTextPort,
  resolvePortType,
} from '@/utils/portUtils';
import { API_V1_URL, api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import { useApiKeyStore } from '@/store/apiKeyStore';
import type { WorkflowSchedule } from '@shipsec/shared';
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/useWorkflowSchedulesContext';
import { formatScheduleTimestamp, scheduleStatusVariant } from './schedules-utils';

const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint';

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left bg-muted/30 hover:bg-muted/50 transition-colors border-b"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{title}</span>
        </div>
        {count !== undefined && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {count}
          </Badge>
        )}
      </button>
      {isOpen && <div className="px-3 pb-3 pt-2 border-t">{children}</div>}
    </div>
  );
}

interface ConfigPanelProps {
  selectedNode: Node<FrontendNodeData> | null;
  onClose: () => void;
  onUpdateNode?: (id: string, data: Partial<FrontendNodeData>) => void;
  workflowId?: string | null;
  workflowSchedules?: WorkflowSchedule[];
  schedulesLoading?: boolean;
  scheduleError?: string | null;
  onScheduleCreate?: () => void;
  onScheduleEdit?: (schedule: WorkflowSchedule) => void;
  onScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules?: () => void;
}

const PANEL_WIDTH = 432;

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

const buildSampleValueForRuntimeInput = (type?: string, id?: string) => {
  switch (type) {
    case 'number':
      return 0;
    case 'json':
      return { example: true };
    case 'array':
      return ['value-1'];
    case 'file':
      return 'upload-file-id';
    case 'text':
    default:
      return id ? `${id}-value` : 'value';
  }
};

const normalizeRuntimeInputs = (value: unknown) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

interface ManualListChipsInputProps {
  inputId: string;
  manualValue: unknown;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string[] | undefined) => void;
}

function ManualListChipsInput({
  inputId,
  manualValue,
  disabled,
  placeholder,
  onChange,
}: ManualListChipsInputProps) {
  const listItems = Array.isArray(manualValue)
    ? manualValue.filter((item): item is string => typeof item === 'string')
    : [];
  const [draftValue, setDraftValue] = useState('');

  useEffect(() => {
    setDraftValue('');
  }, [manualValue]);

  const handleAdd = () => {
    const nextValue = draftValue.trim();
    if (!nextValue) {
      return;
    }
    onChange([...listItems, nextValue]);
    setDraftValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!disabled) {
        handleAdd();
      }
    }
  };

  const handleRemove = (index: number) => {
    if (disabled) return;
    const remaining = [...listItems];
    remaining.splice(index, 1);
    onChange(remaining.length > 0 ? remaining : undefined);
  };

  const handleClear = () => {
    if (disabled) return;
    onChange(undefined);
  };

  const canAdd = draftValue.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={`manual-${inputId}-list`}
          placeholder={placeholder}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="flex-1 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={disabled || !canAdd}
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {listItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listItems.map((item, index) => (
            <Badge key={`${inputId}-chip-${index}`} variant="outline" className="gap-1 pr-1">
              <span className="max-w-[160px] truncate">{item}</span>
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground transition hover:text-foreground hover:bg-muted"
                  onClick={() => handleRemove(index)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && listItems.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-fit text-xs px-2"
          onClick={handleClear}
        >
          Clear manual value
        </Button>
      )}
    </div>
  );
}

/**
 * ConfigPanel - Configuration panel for selected workflow node
 *
 * Shows component information and allows editing node parameters
 */
export function ConfigPanel({
  selectedNode,
  onClose,
  onUpdateNode,
  workflowId: workflowIdProp,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
}: ConfigPanelProps) {
  const isMobile = useIsMobile();
  const { getComponent, loading } = useComponentStore();
  const { getEdges, getNodes } = useReactFlow();
  const fallbackWorkflowId = useWorkflowStore((state) => state.metadata.id);
  const workflowId = workflowIdProp ?? fallbackWorkflowId;
  const navigate = useNavigate();
  const schedulesContext = useOptionalWorkflowSchedulesContext();

  // Get API key for curl command

  const lastCreatedKey = useApiKeyStore((state) => state.lastCreatedKey);
  const fetchApiKeys = useApiKeyStore((state) => state.fetchApiKeys);

  // Fetch API keys on mount if not already loaded
  useEffect(() => {
    fetchApiKeys().catch(console.error);
  }, [fetchApiKeys]);

  // Use lastCreatedKey (full key) if available, otherwise null (will show placeholder)
  const activeApiKey = lastCreatedKey || null;

  // Fixed width on desktop, full width on mobile
  const effectiveWidth = isMobile ? '100%' : PANEL_WIDTH;

  const handleParamValueChange = (paramId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return;

    const nodeData: FrontendNodeData = selectedNode.data;
    const config = nodeData.config || { params: {}, inputOverrides: {} };

    let updatedParams = {
      ...(config.params ?? {}),
    };

    if (value === undefined) {
      const { [paramId]: _removed, ...rest } = updatedParams;
      updatedParams = rest;
    } else {
      updatedParams[paramId] = value;
    }

    onUpdateNode(selectedNode.id, {
      config: {
        ...config,
        params: updatedParams,
      },
    });
  };

  const handleInputOverrideChange = (inputId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return;

    const nodeData: FrontendNodeData = selectedNode.data;
    const config = nodeData.config || { params: {}, inputOverrides: {} };

    let updatedOverrides = {
      ...(config.inputOverrides ?? {}),
    };

    if (value === undefined) {
      const { [inputId]: _removed, ...rest } = updatedOverrides;
      updatedOverrides = rest;
    } else {
      updatedOverrides[inputId] = value;
    }

    onUpdateNode(selectedNode.id, {
      config: {
        ...config,
        inputOverrides: updatedOverrides,
      },
    });
  };

  if (!selectedNode) {
    return null;
  }

  const nodeData: FrontendNodeData = selectedNode.data;
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug;
  const isToolMode = Boolean(
    (nodeData.config as any)?.isToolMode || (nodeData.config as any)?.mode === 'tool',
  );
  const component = getComponent(componentRef);

  if (!component) {
    if (loading) {
      return (
        <div
          className="config-panel border-l bg-background flex flex-col h-full relative"
          style={{ width: effectiveWidth }}
        >
          <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
            <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
              onClick={onClose}
            >
              <X className="h-5 w-5 md:h-4 md:w-4" />
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
          </div>
        </div>
      );
    }
    return (
      <div
        className="config-panel border-l bg-background flex flex-col h-full relative"
        style={{ width: effectiveWidth }}
      >
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
          <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-5 w-5 md:h-4 md:w-4" />
          </Button>
        </div>
        <div className="flex-1 p-4">
          <div className="text-sm text-red-700 dark:text-red-300 font-medium bg-red-50 dark:bg-red-900/40 p-3 rounded-lg border border-red-200 dark:border-red-800">
            Component not found: {componentRef ?? 'unknown'}
          </div>
        </div>
      </div>
    );
  }

  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box';
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as ComponentType<{
    className?: string;
  }>;

  const manualParameters = (nodeData.config?.params ?? {}) as Record<string, unknown>;
  const inputOverrides = (nodeData.config?.inputOverrides ?? {}) as Record<string, unknown>;

  // Dynamic Ports Resolution
  const [dynamicInputs, setDynamicInputs] = useState<any[] | null>(null);
  const [dynamicOutputs, setDynamicOutputs] = useState<any[] | null>(null);

  // Node name editing state
  const [isEditingNodeName, setIsEditingNodeName] = useState(false);
  const [editingNodeName, setEditingNodeName] = useState('');

  const handleSaveNodeName = useCallback(() => {
    const trimmedName = editingNodeName.trim();
    if (trimmedName && trimmedName !== nodeData.label) {
      onUpdateNode?.(selectedNode.id, { label: trimmedName });
    }
    setIsEditingNodeName(false);
  }, [editingNodeName, nodeData.label, onUpdateNode, selectedNode.id]);

  // Debounce ref
  const assertPortResolution = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // If component doesn't have resolvePorts capability, skip
    // We assume all might have it for now, or check metadata if available

    // reset if component changes
    if (!component) return;

    // Debounce the API call
    if (assertPortResolution.current) {
      clearTimeout(assertPortResolution.current);
    }

    assertPortResolution.current = setTimeout(async () => {
      try {
        // Only call if we have parameters
        // combine params and overrides for resolvePorts as it might need both
        const result = await api.components.resolvePorts(component.id, {
          ...manualParameters,
          ...inputOverrides,
        });
        if (result) {
          if (result.inputs) {
            setDynamicInputs(result.inputs);
            const currentDynamic = selectedNode?.data?.dynamicInputs;
            if (JSON.stringify(currentDynamic) !== JSON.stringify(result.inputs)) {
              onUpdateNode?.(selectedNode!.id, { dynamicInputs: result.inputs });
            }
          }
          if (result.outputs) {
            setDynamicOutputs(result.outputs);
            const currentDynamicOutputs = selectedNode?.data?.dynamicOutputs;
            if (JSON.stringify(currentDynamicOutputs) !== JSON.stringify(result.outputs)) {
              onUpdateNode?.(selectedNode!.id, { dynamicOutputs: result.outputs });
            }
          }
        }
      } catch (e) {
        console.error('Failed to resolve dynamic ports', e);
      }
    }, 500); // 500ms debounce

    return () => {
      if (assertPortResolution.current) {
        clearTimeout(assertPortResolution.current);
      }
    };
  }, [component?.id, JSON.stringify(manualParameters), JSON.stringify(inputOverrides)]); // Deep compare parameters and overrides

  const componentInputs = dynamicInputs ?? component.inputs ?? [];
  const componentOutputs = dynamicOutputs ?? component.outputs ?? [];
  const componentParameters = component.parameters ?? [];
  const toolSchemaJson = useMemo(() => {
    if (!component.toolSchema) {
      return null;
    }
    if (typeof component.toolSchema === 'string') {
      return component.toolSchema;
    }
    try {
      return JSON.stringify(component.toolSchema, null, 2);
    } catch (_error) {
      return String(component.toolSchema);
    }
  }, [component.toolSchema]);
  const toolSchemaObject = useMemo(() => {
    if (!component.toolSchema) {
      return null;
    }
    if (typeof component.toolSchema === 'string') {
      try {
        return JSON.parse(component.toolSchema);
      } catch (_error) {
        return null;
      }
    }
    if (typeof component.toolSchema === 'object') {
      return component.toolSchema as Record<string, any>;
    }
    return null;
  }, [component.toolSchema]);
  const toolSchemaFields = useMemo(() => {
    const properties = toolSchemaObject?.properties ?? {};
    const required = new Set((toolSchemaObject?.required as string[]) ?? []);
    return Object.entries(properties).map(([id, schema]) => {
      const typed = schema as Record<string, any>;
      const type =
        typeof typed.type === 'string'
          ? typed.type
          : Array.isArray(typed.type)
            ? typed.type.join(' | ')
            : 'object';
      return {
        id,
        type,
        description: typed.description as string | undefined,
        required: required.has(id),
        defaultValue: typed.default,
        enumValues: Array.isArray(typed.enum) ? typed.enum : undefined,
      };
    });
  }, [toolSchemaObject]);
  const exampleItems = [component.example, ...(component.examples ?? [])].filter(
    (value): value is string => Boolean(value && value.trim().length > 0),
  );
  const [scheduleActionState, setScheduleActionState] = useState<
    Record<string, 'pause' | 'resume' | 'run'>
  >({});
  const handleNavigateSchedules = useCallback(() => {
    if (!workflowId) {
      navigate('/schedules');
      return;
    }
    navigate(`/schedules?workflowId=${workflowId}`);
  }, [navigate, workflowId]);
  const viewSchedules = onViewSchedules ?? handleNavigateSchedules;
  const schedulesDisabled = !workflowId;
  const handleCreateSchedule = useCallback(() => {
    if (schedulesDisabled) {
      viewSchedules();
      return;
    }
    if (onScheduleCreate) {
      onScheduleCreate();
    } else {
      viewSchedules();
    }
  }, [onScheduleCreate, schedulesDisabled, viewSchedules]);
  const handleEditSchedule = useCallback(
    (schedule: WorkflowSchedule) => {
      if (onScheduleEdit) {
        onScheduleEdit(schedule);
      } else {
        viewSchedules();
      }
    },
    [onScheduleEdit, viewSchedules],
  );
  const handleScheduleActionClick = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      if (!onScheduleAction) {
        viewSchedules();
        return;
      }
      setScheduleActionState((state) => ({ ...state, [schedule.id]: action }));
      try {
        await onScheduleAction(schedule, action);
      } finally {
        setScheduleActionState((state) => {
          const { [schedule.id]: _removed, ...rest } = state;
          return rest;
        });
      }
    },
    [onScheduleAction, viewSchedules],
  );
  const isEntryPointComponent = component.id === ENTRY_COMPONENT_ID;
  const runtimeInputDefinitions = normalizeRuntimeInputs(manualParameters.runtimeInputs);
  const entryPointPayload = {
    inputs: runtimeInputDefinitions.reduce<Record<string, unknown>>((acc, input: any) => {
      if (input?.id) {
        acc[input.id] = buildSampleValueForRuntimeInput(input.type, input.id);
      }
      return acc;
    }, {}),
  };
  const workflowInvokeUrl = workflowId
    ? `${API_V1_URL}/workflows/${workflowId}/run`
    : `${API_V1_URL}/workflows/{workflowId}/run`;

  return (
    <div
      className="config-panel border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width: effectiveWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
        <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
          onClick={onClose}
        >
          <X className="h-5 w-5 md:h-4 md:w-4" />
        </Button>
      </div>

      {/* Component Info with inline Node Name editing */}
      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg border bg-background flex-shrink-0">
            {component.logo ? (
              <img
                src={component.logo}
                alt={component.name}
                className="h-6 w-6 object-contain"
                onError={(e) => {
                  // Fallback to icon if image fails to load
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <IconComponent className={cn('h-6 w-6 text-primary', component.logo && 'hidden')} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Node Name - editable for non-entry-point nodes */}
            {!isEntryPointComponent && isEditingNodeName ? (
              <div className="flex items-center gap-1">
                <Input
                  type="text"
                  value={editingNodeName}
                  onChange={(e) => setEditingNodeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveNodeName();
                    } else if (e.key === 'Escape') {
                      setIsEditingNodeName(false);
                    }
                  }}
                  onBlur={handleSaveNodeName}
                  placeholder={component.name}
                  className="h-6 text-sm font-medium py-0 px-1"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0"
                  onClick={handleSaveNodeName}
                >
                  <Check className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group">
                <h4 className="font-medium text-sm truncate">{nodeData.label || component.name}</h4>
                {!isEntryPointComponent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      setEditingNodeName(nodeData.label || component.name);
                      setIsEditingNodeName(true);
                    }}
                    title="Rename node"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            {/* Show component name as subscript if custom name is set */}
            {nodeData.label && nodeData.label !== component.name && (
              <span className="text-[10px] text-muted-foreground opacity-70">{component.name}</span>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {component.description}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2">
          {/* Documentation */}
          {(component.documentation || component.documentationUrl) && (
            <CollapsibleSection title="Documentation" defaultOpen={false}>
              <div className="space-y-0 mt-2">
                {component.documentationUrl && (
                  <div
                    className={cn('py-3', component.documentation && 'border-b border-border pb-3')}
                  >
                    <a
                      href={component.documentationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs hover:text-primary transition-colors group"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <span className="text-muted-foreground group-hover:text-foreground">
                        View external documentation
                      </span>
                    </a>
                  </div>
                )}
                {component.documentation && (
                  <div className="py-3">
                    <MarkdownView
                      content={component.documentation}
                      dataTestId="component-documentation"
                      className={cn(
                        'prose prose-sm dark:prose-invert max-w-none',
                        'text-foreground prose-headings:text-foreground',
                        'prose-p:text-muted-foreground prose-p:text-xs prose-p:leading-relaxed',
                        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
                        'prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
                        'prose-pre:bg-muted prose-pre:text-xs',
                        'prose-ul:text-xs prose-ol:text-xs',
                        'prose-li:text-muted-foreground',
                      )}
                    />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {isToolMode && (
            <CollapsibleSection title="Tool" defaultOpen={true}>
              <div className="space-y-3 mt-2">
                <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {component.toolProvider?.name ?? component.slug}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">{component.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {component.toolProvider?.description ?? component.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase text-muted-foreground">Arguments</div>
                  {toolSchemaFields.length > 0 ? (
                    <div className="space-y-2">
                      {toolSchemaFields.map((field) => (
                        <div
                          key={field.id}
                          className="rounded-md border bg-background/60 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{field.id}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {field.type}
                            </Badge>
                            {field.required && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono text-destructive border-destructive/40"
                              >
                                required
                              </Badge>
                            )}
                          </div>
                          {field.description && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {field.description}
                            </p>
                          )}
                          {(field.defaultValue !== undefined || field.enumValues) && (
                            <div className="mt-2 text-[11px] text-muted-foreground space-y-1">
                              {field.defaultValue !== undefined && (
                                <div>
                                  Default:{' '}
                                  <span className="font-mono text-foreground">
                                    {JSON.stringify(field.defaultValue)}
                                  </span>
                                </div>
                              )}
                              {field.enumValues && (
                                <div>
                                  Enum:{' '}
                                  <span className="font-mono text-foreground">
                                    {field.enumValues
                                      .map((value) => JSON.stringify(value))
                                      .join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No tool schema available for this node.
                    </p>
                  )}
                </div>

                {toolSchemaJson && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase text-muted-foreground">Raw Schema</div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
                      {toolSchemaJson}
                    </pre>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Parameters Section (Moved to Top) */}
          {/* Show parameters if not tool mode, OR if we're in tool mode but have parameters to configure (e.g., MCP components) */}
          {(!isToolMode || componentParameters.length > 0) && (
            <CollapsibleSection
              title="Parameters"
              count={componentParameters.length}
              defaultOpen={true}
            >
              <div className="space-y-0 mt-2">
                {/* Render parameters in component definition order to preserve hierarchy */}
                {componentParameters.map((param, index) => {
                  // Only show border between top-level parameters (not nested ones)
                  const isTopLevel = !param.visibleWhen;
                  const prevParam = index > 0 ? componentParameters[index - 1] : null;
                  const prevIsTopLevel = prevParam ? !prevParam.visibleWhen : false;
                  const showBorder = index > 0 && isTopLevel && prevIsTopLevel;

                  return (
                    <div key={param.id} className={cn(showBorder && 'border-t border-border pt-3')}>
                      <ParameterFieldWrapper
                        parameter={param}
                        value={manualParameters[param.id]}
                        onChange={(value) => handleParamValueChange(param.id, value)}
                        connectedInput={nodeData.inputs?.[param.id]}
                        componentId={component.id}
                        parameters={manualParameters}
                        onUpdateParameter={handleParamValueChange}
                        allComponentParameters={componentParameters}
                      />
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Inputs Section - hide for Entry Point if only __runtimeData exists */}
          {componentInputs.length > 0 &&
            !(isEntryPointComponent && componentInputs.every((i) => i.id === '__runtimeData')) && (
              <CollapsibleSection
                title="Inputs"
                count={
                  isToolMode
                    ? componentInputs.filter(isCredentialInput).length
                    : isEntryPointComponent
                      ? componentInputs.filter((i) => i.id !== '__runtimeData').length
                      : componentInputs.length
                }
                defaultOpen={true}
              >
                <div className="space-y-0 mt-2">
                  {componentInputs.map((input, index) => {
                    // Skip __runtimeData input for Entry Point - default values are now set in the RuntimeInputsEditor
                    if (isEntryPointComponent && input.id === '__runtimeData') {
                      return null;
                    }

                    // Filter out non-credential inputs in tool mode
                    if (isToolMode && !isCredentialInput(input)) {
                      return null;
                    }

                    // Handle tools port with multiple connections
                    const isToolsPort = input.id === 'tools';
                    const toolEdges = isToolsPort
                      ? getEdges().filter(
                          (edge) =>
                            edge.target === selectedNode.id && edge.targetHandle === 'tools',
                        )
                      : [];
                    const connection = isToolsPort ? undefined : nodeData.inputs?.[input.id];
                    const hasConnection = isToolsPort ? toolEdges.length > 0 : Boolean(connection);
                    const manualValue = inputOverrides[input.id];
                    const manualOverridesPort = input.valuePriority === 'manual-first';
                    const allowsManualInput =
                      inputSupportsManualValue(input) || manualOverridesPort;
                    const manualValueProvided =
                      allowsManualInput &&
                      (!hasConnection || manualOverridesPort) &&
                      manualValue !== undefined &&
                      manualValue !== null &&
                      (typeof manualValue === 'string' ? manualValue.trim().length > 0 : true);
                    const manualLocked = hasConnection && !manualOverridesPort;
                    const connectedSourceLabels = isToolsPort
                      ? toolEdges
                          .map((edge) => {
                            const sourceNode = getNodes().find((n) => n.id === edge.source);
                            return (sourceNode?.data as any)?.label || edge.source;
                          })
                          .filter(Boolean)
                      : connection
                        ? [connection.source]
                        : [];
                    const connectedSummary = (() => {
                      if (connectedSourceLabels.length === 0) return '';
                      if (connectedSourceLabels.length <= 2) {
                        return connectedSourceLabels.join(', ');
                      }
                      return `${connectedSourceLabels.slice(0, 2).join(', ')} +${
                        connectedSourceLabels.length - 2
                      }`;
                    })();
                    const portType = resolvePortType(input);
                    const primitiveName = portType?.kind === 'primitive' ? portType.name : null;
                    const isNumberInput = primitiveName === 'number';
                    const isBooleanInput = primitiveName === 'boolean';
                    const isListOfTextInput = isListOfTextPort(portType);
                    const manualInputValue =
                      manualValue === undefined || manualValue === null
                        ? ''
                        : typeof manualValue === 'string'
                          ? manualValue
                          : String(manualValue);
                    const isSecretInput = input.editor === 'secret' || primitiveName === 'secret';
                    const useSecretSelect = isSecretInput;
                    const manualPlaceholder = useSecretSelect
                      ? 'Select a secret...'
                      : input.id === 'supabaseUrl'
                        ? 'https://<project-ref>.supabase.co or <project_ref>'
                        : isNumberInput
                          ? 'Enter a number to use without a connection'
                          : isListOfTextInput
                            ? 'Add entries or press Add to provide a list'
                            : 'Enter text to use without a connection';
                    const typeLabel = describePortType(portType);

                    return (
                      <div
                        key={input.id}
                        className={cn('py-3', index > 0 && 'border-t border-border')}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{input.label}</span>
                            {input.required && (
                              <span className="text-[9px] text-destructive font-medium">*</span>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                            {typeLabel}
                          </Badge>
                        </div>
                        {input.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                            {input.description}
                          </p>
                        )}

                        {allowsManualInput && (
                          <div className="mt-2 space-y-1.5">
                            <label
                              htmlFor={`manual-${input.id}`}
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              Value
                            </label>
                            {useSecretSelect ? (
                              <SecretSelect
                                value={typeof manualValue === 'string' ? manualValue : ''}
                                onChange={(value) => {
                                  // Handle both undefined (from clear button) and empty string
                                  if (value === undefined || value === '' || value === null) {
                                    handleInputOverrideChange(input.id, undefined);
                                  } else {
                                    handleInputOverrideChange(input.id, value);
                                  }
                                }}
                                placeholder={manualPlaceholder}
                                className="text-sm"
                                disabled={manualLocked}
                              />
                            ) : isBooleanInput ? (
                              <div className="space-y-2">
                                <Select
                                  value={
                                    typeof manualValue === 'boolean'
                                      ? manualValue
                                        ? 'true'
                                        : 'false'
                                      : undefined
                                  }
                                  onValueChange={(value) => {
                                    if (value === 'true') {
                                      handleInputOverrideChange(input.id, true);
                                    } else if (value === 'false') {
                                      handleInputOverrideChange(input.id, false);
                                    }
                                  }}
                                  disabled={manualLocked}
                                >
                                  <SelectTrigger className="text-sm">
                                    <SelectValue placeholder="Select true or false" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="true">True</SelectItem>
                                    <SelectItem value="false">False</SelectItem>
                                  </SelectContent>
                                </Select>
                                {!manualLocked && typeof manualValue === 'boolean' && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-fit text-xs px-2"
                                    onClick={() => handleInputOverrideChange(input.id, undefined)}
                                  >
                                    Clear manual value
                                  </Button>
                                )}
                              </div>
                            ) : isListOfTextInput ? (
                              <ManualListChipsInput
                                inputId={input.id}
                                manualValue={manualValue}
                                disabled={manualLocked}
                                placeholder={manualPlaceholder}
                                onChange={(value) => handleInputOverrideChange(input.id, value)}
                              />
                            ) : component?.id === 'core.artifact.writer' &&
                              input.id === 'artifactName' ? (
                              <DynamicArtifactNameInput
                                value={manualInputValue}
                                onChange={(value) => {
                                  if (!value || value === '') {
                                    handleInputOverrideChange(input.id, undefined);
                                  } else {
                                    handleInputOverrideChange(input.id, value);
                                  }
                                }}
                                disabled={manualLocked}
                                placeholder="{{run_id}}-{{timestamp}}"
                              />
                            ) : (
                              <Input
                                id={`manual-${input.id}`}
                                type={isNumberInput ? 'number' : 'text'}
                                value={manualInputValue}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  if (nextValue === '') {
                                    handleInputOverrideChange(input.id, undefined);
                                    return;
                                  }
                                  if (isNumberInput) {
                                    const parsed = Number(nextValue);
                                    if (Number.isNaN(parsed)) {
                                      return;
                                    }
                                    handleInputOverrideChange(input.id, parsed);
                                  } else {
                                    handleInputOverrideChange(input.id, nextValue);
                                  }
                                }}
                                placeholder={manualPlaceholder}
                                className="text-sm"
                                disabled={manualLocked}
                              />
                            )}
                            {/* Skip helper text for DynamicArtifactNameInput as it has its own */}
                            {!(
                              component?.id === 'core.artifact.writer' &&
                              input.id === 'artifactName'
                            ) &&
                              (manualLocked ? (
                                <p className="text-xs text-muted-foreground italic">
                                  Disconnect the port to edit manual input.
                                </p>
                              ) : (
                                <p className="text-[10px] text-muted-foreground">
                                  {isBooleanInput
                                    ? 'Select a value or clear manual input to require a port connection.'
                                    : isListOfTextInput
                                      ? 'Add entries or clear manual input to require a port connection.'
                                      : 'Leave blank to require a port connection.'}
                                </p>
                              ))}
                          </div>
                        )}

                        {/* Connection status - compact */}
                        <div className="mt-2 text-[11px]">
                          {manualValueProvided ? (
                            <div className="flex items-center gap-1.5 text-primary">
                              <Circle className="h-2 w-2 fill-current" />
                              <span>Value set</span>
                            </div>
                          ) : hasConnection ? (
                            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Connected from {connectedSummary || connection?.source}</span>
                            </div>
                          ) : input.required ? (
                            <div className="flex items-center gap-1.5 text-destructive">
                              <AlertCircle className="h-3 w-3" />
                              <span>Required</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Optional</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

          {!isToolMode &&
            !!component.toolProvider &&
            toolSchemaJson &&
            component.category !== 'mcp' && (
              <CollapsibleSection title="Tool Schema" defaultOpen={false}>
                <div className="mt-2">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
                    {toolSchemaJson}
                  </pre>
                </div>
              </CollapsibleSection>
            )}

          {component.category === 'mcp' && component.toolProvider?.name && (
            <CollapsibleSection title="MCP Server" defaultOpen={false}>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Tool name: </span>
                  <span className="font-mono">{component.toolProvider.name}</span>
                </div>
                {component.toolProvider.description && (
                  <div className="text-[11px] leading-relaxed">
                    {component.toolProvider.description}
                  </div>
                )}
                <div className="text-[11px] italic">
                  Tool list appears after the MCP server starts at runtime.
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Outputs Section */}
          {!isToolMode && componentOutputs.length > 0 && (
            <CollapsibleSection title="Outputs" count={componentOutputs.length} defaultOpen={true}>
              <div className="space-y-0 mt-2">
                {componentOutputs.map((output, index) => (
                  <div
                    key={output.id}
                    className={cn('py-3', index > 0 && 'border-t border-border')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{output.label}</span>
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                        {describePortType(resolvePortType(output))}
                      </Badge>
                    </div>
                    {output.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {output.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {isEntryPointComponent && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      <h5 className="text-sm font-semibold text-foreground">Webhooks</h5>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        title="Manage API Keys"
                        onClick={() => navigate('/api-keys')}
                      >
                        <LucideIcons.Key className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <WebhookDetails
                        url={workflowInvokeUrl}
                        payload={entryPointPayload}
                        apiKey={activeApiKey}
                        triggerLabel="View Code"
                        className="h-7 text-xs px-2.5 bg-background shadow-xs hover:bg-background/80"
                      />
                      {workflowId && schedulesContext?.onOpenWebhooksSidebar && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2.5"
                          onClick={schedulesContext.onOpenWebhooksSidebar}
                        >
                          Manage
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {workflowId
                      ? 'Trigger this workflow via HTTP POST. Create custom webhooks to transform payloads.'
                      : 'Save this workflow to get webhook URLs.'}
                  </p>
                </div>
                {workflowId && (
                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground mb-1">
                      Default Endpoint
                    </div>
                    <div className="relative group">
                      <code className="block rounded-lg border bg-background px-3 py-2 text-xs font-mono text-foreground overflow-x-auto break-all">
                        {workflowInvokeUrl}
                      </code>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">Schedules</h5>
                    <p className="text-xs text-muted-foreground">
                      {workflowId
                        ? 'Create recurring runs and manage Temporal schedules for this workflow.'
                        : 'Save this workflow to start managing schedules.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCreateSchedule}
                      disabled={schedulesDisabled}
                    >
                      Create schedule
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={viewSchedules}>
                      View all
                    </Button>
                  </div>
                </div>
                {schedulesDisabled ? (
                  <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    Save this workflow to configure schedules.
                  </div>
                ) : schedulesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading schedules…
                  </div>
                ) : scheduleError ? (
                  <div className="rounded border border-dashed border-destructive/50 bg-background/60 px-3 py-2 text-xs text-destructive">
                    {scheduleError}
                  </div>
                ) : workflowSchedules && workflowSchedules.length > 0 ? (
                  <div className="space-y-3">
                    {workflowSchedules.map((schedule) => {
                      const actionLabel = schedule.status === 'active' ? 'Pause' : 'Resume';
                      const actionKey = schedule.status === 'active' ? 'pause' : 'resume';
                      const pendingAction = scheduleActionState[schedule.id];
                      return (
                        <div
                          key={schedule.id}
                          className="rounded-lg border bg-background px-3 py-2 space-y-2"
                        >
                          <div className="flex flex-col gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-sm font-semibold truncate min-w-0">
                                        {schedule.name}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">{schedule.name}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <Badge
                                  variant={scheduleStatusVariant[schedule.status]}
                                  className="text-[11px] capitalize flex-shrink-0"
                                >
                                  {schedule.status}
                                </Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Next: {formatScheduleTimestamp(schedule.nextRunAt)}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(pendingAction)}
                                onClick={() =>
                                  handleScheduleActionClick(
                                    schedule,
                                    actionKey as 'pause' | 'resume',
                                  )
                                }
                              >
                                {pendingAction === 'pause' || pendingAction === 'resume' ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                {actionLabel}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={Boolean(pendingAction)}
                                onClick={() => handleScheduleActionClick(schedule, 'run')}
                              >
                                Run now
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditSchedule(schedule)}
                              >
                                Edit
                              </Button>
                              {onScheduleDelete && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`,
                                      )
                                    ) {
                                      onScheduleDelete(schedule);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {schedule.description && (
                            <p className="text-xs text-muted-foreground">{schedule.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    No schedules yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Examples */}
          {exampleItems.length > 0 && (
            <CollapsibleSection title="Examples" count={exampleItems.length} defaultOpen={false}>
              <div className="space-y-0 mt-2">
                {exampleItems.map((exampleText, index) => {
                  const commandMatch = exampleText.match(/`([^`]+)`/);
                  const command = commandMatch?.[1]?.trim();
                  const description = commandMatch
                    ? exampleText
                        .replace(commandMatch[0], '')
                        .replace(/^[\s\u2013\u2014-]+/, '')
                        .trim()
                    : exampleText.trim();

                  return (
                    <div
                      key={`${exampleText}-${index}`}
                      className={cn('py-3', index > 0 && 'border-t border-border')}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                          {index + 1}.
                        </span>
                        <div className="flex-1 space-y-1.5">
                          {command && (
                            <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] font-mono">
                              {command}
                            </code>
                          )}
                          {description && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono truncate max-w-[140px]" title={selectedNode.id}>
            {selectedNode.id}
          </span>
          <span className="font-mono">{component.slug}</span>
        </div>
      </div>
    </div>
  );
}
