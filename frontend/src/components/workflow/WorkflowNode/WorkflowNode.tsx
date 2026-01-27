import { useEffect, useRef, useState } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
  useReactFlow,
  useUpdateNodeInternals,
} from 'reactflow';
import { ExecutionErrorView } from '../ExecutionErrorView';
import {
  Activity,
  AlertCircle,
  Pause,
  Trash2,
  ChevronDown,
  ExternalLink,
  CheckCircle,
  KeyRound,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/ui/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useComponentStore } from '@/store/componentStore';
import { useExecutionStore } from '@/store/executionStore';
import { useExecutionTimelineStore, type NodeVisualState } from '@/store/executionTimelineStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { getNodeStyle } from '../nodeStyles';
import type { NodeData, FrontendNodeData } from '@/schemas/node';
import type { InputPort } from '@/schemas/component';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useThemeStore } from '@/store/themeStore';
import {
  type ComponentCategory,
  getCategorySeparatorColor,
  getCategoryHeaderBackgroundColor,
} from '@/utils/categoryColors';
import { inputSupportsManualValue, runtimeInputTypeToConnectionType } from '@/utils/portUtils';
import { WebhookDetails } from '../WebhookDetails';
import { useApiKeyStore } from '@/store/apiKeyStore';
import { API_V1_URL } from '@/services/api';
import { useNavigate, useParams } from 'react-router-dom';
import { useEntryPointActions } from '../entry-point-context';
import { useSecretStore } from '@/store/secretStore';
import { getSecretLabel } from '@/api/secrets';
import { useIsMobile } from '@/hooks/useIsMobile';

// Import extracted components
import { TerminalButton } from './TerminalButton';
import { ParametersDisplay } from './ParametersDisplay';
import { NodeProgressBar } from './NodeProgressBar';
import { STATUS_ICONS, TEXT_BLOCK_SIZES } from './constants';

const {
  MIN_WIDTH: MIN_TEXT_WIDTH,
  MAX_WIDTH: MAX_TEXT_WIDTH,
  MIN_HEIGHT: MIN_TEXT_HEIGHT,
  MAX_HEIGHT: MAX_TEXT_HEIGHT,
  DEFAULT_WIDTH: DEFAULT_TEXT_WIDTH,
  DEFAULT_HEIGHT: DEFAULT_TEXT_HEIGHT,
} = TEXT_BLOCK_SIZES;

/**
 * Enhanced WorkflowNode - Visual representation with timeline states
 */
export const WorkflowNode = ({ data, selected, id }: NodeProps<NodeData>) => {
  // Store hooks
  const { getComponent, loading } = useComponentStore();
  const secrets = useSecretStore((state) => state.secrets);
  const { getNodes, getEdges, setNodes, deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodeStates, selectedRunId, selectNode, isPlaying, playbackMode, isLiveFollowing } =
    useExecutionTimelineStore();
  const { markDirty } = useWorkflowStore();
  const { mode, focusedTerminalNodeId, bringTerminalToFront, openHumanInputDialog } =
    useWorkflowUiStore();
  const prefetchTerminal = useExecutionStore((state) => state.prefetchTerminal);
  const terminalSession = useExecutionStore((state) => state.getTerminalSession(id, 'pty'));
  const theme = useThemeStore((state) => state.theme);
  const { lastCreatedKey } = useApiKeyStore();
  // @ts-expect-error - FIXME: Check actual store structure
  const workflowIdFromStore = useWorkflowStore((state) => state.workflow?.id);
  const { onOpenScheduleSidebar, onOpenWebhooksSidebar } = useEntryPointActions();

  // Local state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalLoading, setIsTerminalLoading] = useState(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editingLabelValue, setEditingLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const isMobile = useIsMobile();
  const activeApiKey = lastCreatedKey;

  const [textSize, setTextSize] = useState<{ width: number; height: number }>(() => {
    const uiSize = (data as any)?.ui?.size as { width?: number; height?: number } | undefined;
    return {
      width: uiSize?.width ?? DEFAULT_TEXT_WIDTH,
      height: uiSize?.height ?? DEFAULT_TEXT_HEIGHT,
    };
  });

  // Terminal loading effect
  useEffect(() => {
    if (!isTerminalOpen) return;

    let cancelled = false;
    const loadTerminal = async () => {
      setIsTerminalLoading(true);
      try {
        await prefetchTerminal(id, 'pty', selectedRunId ?? undefined);
      } catch (error) {
        console.error('Failed to prefetch terminal output', error);
      } finally {
        if (!cancelled) setIsTerminalLoading(false);
      }
    };

    void loadTerminal();
    return () => {
      cancelled = true;
    };
  }, [id, isTerminalOpen, prefetchTerminal, selectedRunId]);

  // Cast to access extended frontend fields
  const nodeData = data as FrontendNodeData;
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug;
  const component = getComponent(componentRef);
  const isTextBlock = component?.id === 'core.ui.text';
  const isEntryPoint = component?.id === 'core.workflow.entrypoint';
  const isDarkMode = theme === 'dark';
  const componentCategory: ComponentCategory =
    (component?.category as ComponentCategory) || (isEntryPoint ? 'input' : 'input');

  // Workflow ID resolution
  const workflowIdFromNode = (nodeData as any)?.workflowId as string | undefined;
  const params = useParams<{ id?: string }>();
  const workflowIdFromRoute = params?.id && params.id !== 'new' ? params.id : undefined;
  const workflowId = workflowIdFromStore || workflowIdFromNode || workflowIdFromRoute;
  const workflowInvokeUrl = workflowId
    ? `${API_V1_URL}/workflows/${workflowId}/run`
    : `${API_V1_URL}/workflows/{workflowId}/run`;

  // Entry point payload
  const entryPointPayload = (() => {
    const params = nodeData.config?.params || {};
    if (!isEntryPoint || !params.runtimeInputs) return {};
    try {
      const inputs =
        typeof params.runtimeInputs === 'string'
          ? JSON.parse(params.runtimeInputs)
          : params.runtimeInputs;
      if (!Array.isArray(inputs)) return {};
      return inputs.reduce((acc: any, input: any) => {
        acc[input.id] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : 'value';
        return acc;
      }, {});
    } catch {
      return {};
    }
  })();

  // Text size sync effect
  useEffect(() => {
    if (!isTextBlock) return;
    const uiSize = (nodeData as any)?.ui?.size as { width?: number; height?: number } | undefined;
    if (!uiSize) return;
    setTextSize((current) => {
      const nextWidth = uiSize.width ?? current.width;
      const nextHeight = uiSize.height ?? current.height;
      const clamped = {
        width: Math.max(MIN_TEXT_WIDTH, Math.min(MAX_TEXT_WIDTH, nextWidth)),
        height: Math.max(MIN_TEXT_HEIGHT, Math.min(MAX_TEXT_HEIGHT, nextHeight)),
      };
      if (current.width === clamped.width && current.height === clamped.height) return current;
      return clamped;
    });
  }, [isTextBlock, nodeData]);

  useEffect(() => {
    if (isTextBlock) updateNodeInternals(id);
  }, [id, isTextBlock, updateNodeInternals]);

  // Resize handling
  const isResizing = useRef(false);
  const clampWidth = (width: number) => Math.max(MIN_TEXT_WIDTH, Math.min(MAX_TEXT_WIDTH, width));
  const clampHeight = (height: number) =>
    Math.max(MIN_TEXT_HEIGHT, Math.min(MAX_TEXT_HEIGHT, height));

  const persistSize = (width: number, height: number) => {
    const clampedWidth = clampWidth(width);
    const clampedHeight = clampHeight(height);
    setTextSize({ width: clampedWidth, height: clampedHeight });
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...(node.data as any),
                ui: {
                  ...(node.data as any).ui,
                  size: { width: clampedWidth, height: clampedHeight },
                },
              },
            }
          : node,
      ),
    );
    updateNodeInternals(id);
    markDirty();
  };

  const handleResizeStart = () => {
    isResizing.current = true;
  };
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteElements({ nodes: [{ id }] });
    markDirty();
  };
  const handleResize = (_evt: unknown, params: { width: number; height: number }) => {
    if (nodeRef.current) {
      nodeRef.current.style.width = `${clampWidth(params.width)}px`;
      nodeRef.current.style.minHeight = `${clampHeight(params.height)}px`;
    }
  };
  const handleResizeEnd = (_evt: unknown, params: { width: number; height: number }) => {
    isResizing.current = false;
    persistSize(params.width, params.height);
  };

  // Visual state
  const visualState: NodeVisualState = nodeStates[id] || {
    status: 'idle',
    progress: 0,
    startTime: 0,
    eventCount: 0,
    totalEvents: 0,
    lastEvent: null,
    dataFlow: { input: [], output: [] },
  };

  // Auto-collapse error details
  useEffect(() => {
    if (visualState.status !== 'error') setShowErrorDetails(false);
  }, [visualState.status]);

  // Dynamic outputs
  let effectiveOutputs: any[] =
    nodeData.dynamicOutputs ?? (Array.isArray(component?.outputs) ? component.outputs : []);

  const runtimeInputsVal = nodeData.config?.params?.runtimeInputs;
  if (
    !nodeData.dynamicOutputs &&
    component?.id === 'core.workflow.entrypoint' &&
    runtimeInputsVal
  ) {
    try {
      const runtimeInputs =
        typeof runtimeInputsVal === 'string' ? JSON.parse(runtimeInputsVal) : runtimeInputsVal;
      if (Array.isArray(runtimeInputs) && runtimeInputs.length > 0) {
        effectiveOutputs = runtimeInputs.map((input: any) => ({
          id: input.id,
          label: input.label,
          connectionType: runtimeInputTypeToConnectionType(input.type || 'text'),
          description: input.description || `Runtime input: ${input.label}`,
        }));
      }
    } catch (error) {
      console.error('Failed to parse runtimeInputs:', error);
    }
  }

  const componentInputs = nodeData.dynamicInputs ?? component?.inputs ?? [];
  const outputIds = effectiveOutputs.map((o) => o.id).join(',');
  const inputIds = componentInputs.map((i: any) => i.id).join(',');

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputIds, inputIds, updateNodeInternals]);

  const supportsLiveLogs = component?.runner?.kind === 'docker';

  // Early return for loading/missing component
  if (!component) {
    if (loading) {
      return (
        <div className="px-4 py-3 shadow-md rounded-lg border-2 border-dashed border-muted bg-background min-w-[200px]">
          <div className="text-sm text-muted-foreground">Loading component metadata…</div>
        </div>
      );
    }
    return (
      <div className="px-4 py-3 shadow-md rounded-lg border-2 border-red-500 dark:border-red-700 bg-red-50 dark:bg-red-900/40 min-w-[200px]">
        <div className="text-sm text-red-700 dark:text-red-300 font-medium">
          Component not found: {componentRef ?? 'unknown'}
        </div>
      </div>
    );
  }

  // Icon and styling
  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box';
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{
    className?: string;
  }>;
  const effectiveStatus =
    mode === 'execution' && selectedRunId ? visualState.status : nodeData.status || 'idle';
  const nodeStyle = getNodeStyle(effectiveStatus);
  const StatusIcon = STATUS_ICONS[effectiveStatus as keyof typeof STATUS_ICONS];
  const isTimelineActive = mode === 'execution' && selectedRunId && visualState.status !== 'idle';
  const textBlockContent =
    typeof nodeData.config?.params?.content === 'string' ? nodeData.config.params.content : '';
  const trimmedTextBlockContent = textBlockContent.trim();

  // Label handling
  const displayLabel = data.label || component.name;
  const hasCustomLabel = data.label && data.label !== component.name;

  const handleStartEditing = () => {
    if (isEntryPoint || mode !== 'design') return;
    setEditingLabelValue(data.label || component.name);
    setIsEditingLabel(true);
    setTimeout(() => labelInputRef.current?.focus(), 0);
  };
  const handleSaveLabel = () => {
    const trimmedValue = editingLabelValue.trim();
    if (trimmedValue && trimmedValue !== data.label) {
      setNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: trimmedValue } } : n)),
      );
      markDirty();
    }
    setIsEditingLabel(false);
  };
  const handleCancelEditing = () => setIsEditingLabel(false);
  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveLabel();
    } else if (e.key === 'Escape') handleCancelEditing();
  };

  // Validation
  const componentParameters = component.parameters ?? [];
  const manualParameters = (nodeData.config?.params ?? {}) as Record<string, unknown>;
  const inputOverrides = (nodeData.config?.inputOverrides ?? {}) as Record<string, unknown>;
  const requiredParams = componentParameters.filter((param) => param.required);
  const requiredInputs = componentInputs.filter((input: any) => input.required);

  const manualOverridesPort = (input: InputPort) => input.valuePriority === 'manual-first';
  const manualValueProvidedForInput = (input: InputPort, hasConnection: boolean) => {
    const manualEligible = inputSupportsManualValue(input) || manualOverridesPort(input);
    if (!manualEligible) return false;
    if (hasConnection && !manualOverridesPort(input)) return false;
    const manualCandidate = inputOverrides[input.id];
    if (manualCandidate === undefined || manualCandidate === null) return false;
    if (typeof manualCandidate === 'string') return manualCandidate.trim().length > 0;
    return true;
  };

  const hasUnfilledRequired =
    requiredParams.some((param) => {
      const value = manualParameters[param.id];
      const effectiveValue = value !== undefined ? value : param.default;
      return effectiveValue === undefined || effectiveValue === null || effectiveValue === '';
    }) ||
    requiredInputs.some((input) => {
      const hasConnection = Boolean(nodeData.inputs?.[input.id]);
      if (hasConnection) return false;
      if (manualValueProvidedForInput(input, hasConnection)) return false;
      return true;
    });

  // Color utilities
  const getSeparatorColor = (): string | undefined => {
    if (
      (!isTimelineActive || visualState.status === 'idle') &&
      (!nodeData.status || nodeData.status === 'idle')
    ) {
      return getCategorySeparatorColor(componentCategory, isDarkMode);
    }
    return undefined;
  };
  const getHeaderBackgroundColor = (): string | undefined => {
    return getCategoryHeaderBackgroundColor(componentCategory, isDarkMode);
  };

  const separatorColor = getSeparatorColor();
  const headerBackgroundColor = getHeaderBackgroundColor();

  return (
    <div
      className={cn(
        'shadow-lg border-2 transition-[box-shadow,background-color,border-color,transform] relative group',
        'bg-background',
        isEntryPoint ? 'rounded-[1.5rem]' : 'rounded-lg',
        isTextBlock ? 'min-w-[240px] max-w-none flex flex-col' : 'min-w-[240px] max-w-[280px]',
        isEntryPoint &&
          isTimelineActive &&
          effectiveStatus === 'running' &&
          !isPlaying &&
          'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && 'border-blue-400',
        !isEntryPoint &&
          isTimelineActive &&
          effectiveStatus === 'running' &&
          !isPlaying &&
          'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'error' && 'border-red-400',
        !isEntryPoint &&
          (effectiveStatus !== 'idle' || isTimelineActive) && [nodeStyle.bg, nodeStyle.border],
        (!nodeData.status || nodeData.status === 'idle') && !isTimelineActive && ['border-border'],
        selected && 'shadow-[0_0_15px_rgba(59,130,246,0.4),0_0_30px_rgba(59,130,246,0.3)]',
        selected && 'hover:shadow-[0_0_25px_rgba(59,130,246,0.6),0_0_45px_rgba(59,130,246,0.4)]',
        !selected && 'hover:shadow-xl',
        'hover:scale-[1.02]',
        selectedRunId && 'cursor-pointer',
      )}
      ref={nodeRef}
      onClick={() => selectedRunId && selectNode(id)}
      style={{
        ...(isTextBlock
          ? {
              width: Math.max(MIN_TEXT_WIDTH, textSize.width ?? DEFAULT_TEXT_WIDTH),
              minHeight: Math.max(MIN_TEXT_HEIGHT, textSize.height ?? DEFAULT_TEXT_HEIGHT),
            }
          : isEntryPoint
            ? { width: 160, minHeight: 160 }
            : {}),
      }}
    >
      {isTextBlock && mode === 'design' && (
        <NodeResizer
          minWidth={MIN_TEXT_WIDTH}
          maxWidth={MAX_TEXT_WIDTH}
          minHeight={MIN_TEXT_HEIGHT}
          maxHeight={MAX_TEXT_HEIGHT}
          isVisible
          handleClassName="text-node-resize-handle"
          lineClassName="text-node-resize-line"
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}

      {/* Header */}
      <div
        className={cn(
          'px-3 py-2 border-b relative',
          isEntryPoint ? 'rounded-t-[1.5rem]' : 'rounded-t-lg',
        )}
        style={{
          borderColor: separatorColor || 'hsl(var(--border) / 0.5)',
          backgroundColor: headerBackgroundColor || undefined,
        }}
      >
        <div className="flex items-start gap-2">
          {component.logo && (
            <img
              src={component.logo}
              alt={component.name}
              className="h-5 w-5 mt-0.5 flex-shrink-0 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          )}
          <IconComponent
            className={cn(
              'h-5 w-5 mt-0.5 flex-shrink-0 text-foreground',
              component.logo && 'hidden',
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                {isEditingLabel ? (
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={editingLabelValue}
                    onChange={(e) => setEditingLabelValue(e.target.value)}
                    onBlur={handleSaveLabel}
                    onKeyDown={handleLabelKeyDown}
                    className="text-sm font-semibold bg-transparent border-b border-primary outline-none w-full py-0"
                    autoFocus
                  />
                ) : (
                  <div
                    className={cn(
                      'group/label',
                      !isEntryPoint && mode === 'design' && 'cursor-text',
                    )}
                    onDoubleClick={handleStartEditing}
                    title={
                      !isEntryPoint && mode === 'design' ? 'Double-click to rename' : undefined
                    }
                  >
                    <h3 className="text-sm font-semibold truncate">{displayLabel}</h3>
                    {hasCustomLabel && (
                      <span className="text-[10px] text-muted-foreground opacity-70 truncate block">
                        {component.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {isEntryPoint && (
                  <div style={{ display: 'none' }}>
                    <WebhookDetails
                      url={workflowInvokeUrl}
                      payload={entryPointPayload}
                      apiKey={activeApiKey}
                      open={showWebhookDialog}
                      onOpenChange={setShowWebhookDialog}
                    />
                  </div>
                )}
                {hasUnfilledRequired && !nodeData.status && (
                  <span className="text-red-500 text-xs" title="Required fields missing">
                    !
                  </span>
                )}
                {StatusIcon &&
                  (!isTimelineActive || effectiveStatus !== 'running' || isPlaying) &&
                  effectiveStatus !== 'success' && (
                    <StatusIcon
                      className={cn(
                        'h-4 w-4 flex-shrink-0',
                        nodeStyle.iconClass,
                        isTimelineActive &&
                          effectiveStatus === 'running' &&
                          isPlaying &&
                          'animate-spin',
                        isTimelineActive && effectiveStatus === 'error' && 'animate-bounce',
                      )}
                    />
                  )}
                {supportsLiveLogs && mode === 'execution' && selectedRunId && (
                  <TerminalButton
                    id={id}
                    isTerminalOpen={isTerminalOpen}
                    setIsTerminalOpen={setIsTerminalOpen}
                    isTerminalLoading={isTerminalLoading}
                    terminalSession={terminalSession}
                    selectedRunId={selectedRunId}
                    mode={mode}
                    playbackMode={playbackMode}
                    isLiveFollowing={isLiveFollowing}
                    focusedTerminalNodeId={focusedTerminalNodeId}
                    bringTerminalToFront={bringTerminalToFront}
                  />
                )}
                {mode === 'design' && !isEntryPoint && (
                  <button
                    type="button"
                    className={cn(
                      'p-1 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-all',
                      isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                    title="Delete node"
                    aria-label="Delete node"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status and Events Section */}
      {isTimelineActive && (
        <div className="px-3 py-2 border-b border-border/50 bg-muted/30 space-y-2">
          {visualState.status === 'running' && (
            <Badge
              variant="secondary"
              className="text-xs bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700"
            >
              {playbackMode === 'live' ? (
                <>
                  <Activity className="h-3 w-3 mr-1 animate-pulse" />
                  Live
                </>
              ) : isPlaying ? (
                <>
                  <Activity className="h-3 w-3 mr-1" />
                  Running
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3 mr-1" />
                  Paused
                </>
              )}
            </Badge>
          )}
          {visualState.status === 'success' && (
            <Badge
              variant="secondary"
              className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Completed
            </Badge>
          )}
          {visualState.status === 'error' && (
            <Badge
              variant="secondary"
              className={cn(
                'text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 cursor-pointer select-none transition-all hover:ring-2 hover:ring-red-400/50 items-center gap-1',
                showErrorDetails && 'ring-2 ring-red-400/50',
              )}
              onClick={() => setShowErrorDetails(!showErrorDetails)}
              title="Click to toggle error details"
            >
              <AlertCircle className="h-3 w-3" />
              <span>{visualState.lastEvent?.error?.type || 'Failed'}</span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-200',
                  showErrorDetails && 'rotate-180',
                )}
              />
            </Badge>
          )}
          {visualState.status === 'skipped' && (
            <Badge
              variant="secondary"
              className="text-xs bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600"
            >
              <LucideIcons.Ban className="h-3 w-3 mr-1" />
              Skipped
            </Badge>
          )}
          {visualState.lastMetadata?.childRunId && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs font-medium gap-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/20 dark:hover:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/runs/${visualState.lastMetadata!.childRunId}`);
              }}
            >
              <ExternalLink className="h-3 w-3" />
              View Child Run
            </Button>
          )}
          {visualState.status === 'error' && showErrorDetails && visualState.lastEvent?.error && (
            <ExecutionErrorView error={visualState.lastEvent.error} className="mt-2" />
          )}
          <NodeProgressBar
            progress={Number.isFinite(visualState.progress) ? visualState.progress : 0}
            events={visualState.eventCount}
            totalEvents={visualState.totalEvents}
            isRunning={visualState.status === 'running'}
            status={visualState.status}
          />
        </div>
      )}

      {/* Body - Input/Output Ports */}
      <div className={cn('px-3 py-3 pb-4 space-y-2', isTextBlock && 'flex flex-col flex-1')}>
        {effectiveStatus === 'awaiting_input' && visualState.humanInputRequestId && (
          <div className={cn('mb-2', isEntryPoint && 'hidden')}>
            <Button
              variant="outline"
              className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:text-blue-300 border-blue-500/50 shadow-sm animate-pulse h-8 text-xs font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                openHumanInputDialog(visualState.humanInputRequestId!);
              }}
            >
              <LucideIcons.ShieldAlert className="w-3.5 h-3.5 mr-2" />
              Action Required
            </Button>
          </div>
        )}

        {/* Text Block Content */}
        {isTextBlock &&
          (trimmedTextBlockContent.length > 0 ? (
            <MarkdownView
              content={trimmedTextBlockContent}
              dataTestId="text-block-content"
              className={cn(
                'w-full rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-3 overflow-x-hidden overflow-y-auto break-words',
                'prose prose-base dark:prose-invert max-w-none text-foreground',
                'flex-1 min-h-0',
              )}
              onEdit={(next) => {
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id !== id) return n;
                    const currentConfig = (n.data as any).config || {
                      params: {},
                      inputOverrides: {},
                    };
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        config: {
                          ...currentConfig,
                          params: { ...currentConfig.params, content: next },
                        },
                      },
                    };
                  }),
                );
                markDirty();
              }}
            />
          ) : (
            <div
              className={cn(
                'rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm text-muted-foreground leading-relaxed',
                'flex-1 min-h-0',
              )}
              data-testid="text-block-content"
            >
              Add notes in the configuration panel to share context with teammates.
            </div>
          ))}

        {/* Entry Point Layout */}
        {isEntryPoint && (
          <div className="flex gap-3 mt-1">
            <div className="flex-[0.6] flex flex-col gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenWebhooksSidebar) {
                    onOpenWebhooksSidebar();
                  } else {
                    setShowWebhookDialog(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.Webhook className="h-3 w-3 flex-shrink-0" />
                <span>Webhooks</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenScheduleSidebar) {
                    onOpenScheduleSidebar();
                  } else {
                    navigate(`/schedules?workflowId=${workflowId}`);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.CalendarClock className="h-3 w-3 flex-shrink-0" />
                <span>Schedules</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (mode === 'design' && nodeRef.current) {
                    const clickEvent = new MouseEvent('click', {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                    });
                    setTimeout(() => nodeRef.current?.dispatchEvent(clickEvent), 10);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.Settings className="h-3 w-3 flex-shrink-0" />
                <span>Inputs</span>
              </button>
            </div>
            <div className="flex-[0.4] flex flex-col justify-start">
              {effectiveOutputs.length > 0 ? (
                <div className="space-y-1.5">
                  {effectiveOutputs.map((output) => (
                    <div
                      key={output.id}
                      className="relative flex items-center justify-end gap-2 text-xs"
                    >
                      <div className="flex-1 text-right">
                        <div className="text-muted-foreground font-medium">{output.label}</div>
                      </div>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={output.id}
                        className="!w-[10px] !h-[10px] !border-2 !border-green-500 !bg-green-500 !rounded-full"
                        style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative flex items-center justify-end gap-2 text-xs">
                  <div className="flex-1 text-right italic font-medium opacity-60">Triggered</div>
                  <Handle
                    type="source"
                    position={Position.Right}
                    className="!w-[10px] !h-[10px] !border-2 !border-blue-500 !bg-blue-500 !rounded-full"
                    style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Parameters Display */}
        {!isEntryPoint && (
          <ParametersDisplay
            componentParameters={componentParameters}
            requiredParams={requiredParams}
            nodeParameters={nodeData.config?.params}
            position="top"
          />
        )}

        {/* Input Ports */}
        {!isEntryPoint && componentInputs.length > 0 && (
          <div className="space-y-1.5">
            {componentInputs.map((input) => {
              const edges = getEdges();
              const connection = edges.find(
                (edge) => edge.target === id && edge.targetHandle === input.id,
              );
              const hasConnection = Boolean(connection);
              const manualCandidate = inputOverrides[input.id];
              const manualValueProvided = manualValueProvidedForInput(input, hasConnection);

              let sourceInfo: string | null = null;
              if (!manualValueProvided && connection) {
                const sourceNode = getNodes().find((n) => n.id === connection.source);
                if (sourceNode) {
                  const sourceComponent = getComponent(
                    (sourceNode.data as any).componentId ?? (sourceNode.data as any).componentSlug,
                  );
                  if (sourceComponent) {
                    const sourceOutput = sourceComponent.outputs.find(
                      (o) => o.id === connection.sourceHandle,
                    );
                    sourceInfo = sourceOutput?.label || 'Connected';
                  }
                }
              }

              const manualDisplayVal =
                manualValueProvided &&
                inputSupportsManualValue(input) &&
                typeof manualCandidate === 'string'
                  ? manualCandidate.trim()
                  : '';
              let manualDisplay = manualDisplayVal;
              const isSecretInput =
                input.editor === 'secret' ||
                (input.connectionType?.kind === 'primitive' &&
                  input.connectionType.name === 'secret');

              if (isSecretInput && manualDisplayVal) {
                const secret = secrets.find(
                  (s) => s.id === manualDisplayVal || s.name === manualDisplayVal,
                );
                manualDisplay = secret ? getSecretLabel(secret) : manualDisplayVal;
              }

              const previewText =
                manualDisplay.length > 24 ? `${manualDisplay.slice(0, 24)}…` : manualDisplay;
              const handleClassName = cn(
                '!w-[10px] !h-[10px] !border-2 !rounded-full',
                input.required
                  ? '!bg-blue-500 !border-blue-500'
                  : '!bg-background !border-blue-500',
              );

              return (
                <div key={input.id} className="relative flex items-center gap-2 text-xs">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={input.id}
                    className={handleClassName}
                    style={{ top: '50%', left: '-18px', transform: 'translateY(-50%)' }}
                  />
                  <div className="flex-1">
                    <div className="text-muted-foreground font-medium">{input.label}</div>
                    {input.required && !sourceInfo && !manualValueProvided && (
                      <span className="text-red-500 text-[10px]">*required</span>
                    )}
                    {manualValueProvided && manualDisplay && (
                      <div className="mt-0.5">
                        <span
                          className={cn(
                            'font-mono px-1 py-0.5 rounded text-[10px] truncate max-w-[120px] inline-flex items-center gap-1',
                            isSecretInput
                              ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 font-semibold'
                              : 'text-foreground bg-muted',
                          )}
                          title={manualDisplay}
                        >
                          {isSecretInput && <KeyRound className="h-2.5 w-2.5" />}
                          {previewText}
                        </span>
                      </div>
                    )}
                    {manualValueProvided && !manualDisplay && (
                      <span className="text-muted-foreground text-[10px] italic">Manual value</span>
                    )}
                    {!manualValueProvided && sourceInfo && (
                      <span
                        className="text-muted-foreground text-[10px] italic"
                        title={`Connected to: ${sourceInfo}`}
                      >
                        {sourceInfo}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Output Ports */}
        {!isEntryPoint && effectiveOutputs.filter((o: any) => !o.isBranching).length > 0 && (
          <div className="space-y-1.5">
            {effectiveOutputs
              .filter((o: any) => !o.isBranching)
              .map((output: any) => (
                <div
                  key={output.id}
                  className="relative flex items-center justify-end gap-2 text-xs"
                >
                  <div className="flex-1 text-right">
                    <div className="text-muted-foreground font-medium">{output.label}</div>
                  </div>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={output.id}
                    className="!w-[10px] !h-[10px] !border-2 !border-green-500 !bg-green-500 !rounded-full"
                    style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                  />
                </div>
              ))}
          </div>
        )}

        {/* Branching Outputs */}
        {!isEntryPoint &&
          (() => {
            const branchingOutputs = effectiveOutputs.filter((o: any) => o.isBranching);
            if (branchingOutputs.length === 0) return null;

            const data = isTimelineActive ? visualState.lastEvent?.data : undefined;
            const activatedPorts = data?.activatedPorts;
            const legacyActiveBranchId =
              !activatedPorts && data
                ? data.approved === true
                  ? 'approved'
                  : data.approved === false
                    ? 'rejected'
                    : null
                : null;
            const isNodeFinished =
              isTimelineActive &&
              (visualState.status === 'success' || visualState.status === 'error');
            const isNodeSkipped = isTimelineActive && visualState.status === 'skipped';
            const hasBranchDecision = isNodeFinished || isNodeSkipped;

            const designModeColors: Record<string, string> = {
              green:
                'bg-green-50/80 dark:bg-green-900/20 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300',
              red: 'bg-red-50/80 dark:bg-red-900/20 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300',
              amber:
                'bg-amber-50/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300',
              blue: 'bg-blue-50/80 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300',
              purple:
                'bg-purple-50/80 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 text-purple-700 dark:text-purple-300',
              slate:
                'bg-slate-100/80 dark:bg-slate-800/30 border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-300',
            };
            const handleDesignColors: Record<string, string> = {
              green: '!border-green-500 !bg-green-500',
              red: '!border-red-500 !bg-red-500',
              amber: '!border-amber-500 !bg-amber-500',
              blue: '!border-blue-500 !bg-blue-500',
              purple: '!border-purple-500 !bg-purple-500',
              slate: '!border-slate-500 !bg-slate-500',
            };

            return (
              <div className="mt-2 pt-2 border-t border-dashed border-amber-300/50 dark:border-amber-700/50">
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <LucideIcons.GitBranch className="h-3 w-3 text-amber-500 dark:text-amber-400" />
                    <span className="text-[9px] font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wider">
                      Branches
                    </span>
                  </div>
                  <div className="flex flex-col flex-1 gap-1">
                    {branchingOutputs.map((output: any) => {
                      const isActive =
                        isNodeFinished &&
                        (activatedPorts
                          ? activatedPorts.includes(output.id)
                          : legacyActiveBranchId === output.id);
                      const isInactive = isNodeSkipped || (isNodeFinished && !isActive);
                      const branchColor = output.branchColor || 'amber';

                      return (
                        <div
                          key={output.id}
                          className="relative flex items-center justify-end gap-2 text-xs"
                        >
                          <div
                            className={cn(
                              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all',
                              'border',
                              !hasBranchDecision && designModeColors[branchColor],
                              isActive &&
                                'bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 ring-1 ring-green-400/50',
                              isInactive &&
                                'bg-slate-50/50 dark:bg-slate-900/20 border-dashed border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 opacity-30 grayscale-[0.8]',
                            )}
                          >
                            {isActive && <LucideIcons.Check className="h-2.5 w-2.5" />}
                            {isInactive && (
                              <LucideIcons.X className="h-2.5 w-2.5 text-slate-400/50" />
                            )}
                            <span>{output.label}</span>
                          </div>
                          <Handle
                            type="source"
                            position={Position.Right}
                            id={output.id}
                            className={cn(
                              '!w-[10px] !h-[10px] !border-2 !rounded-full',
                              !hasBranchDecision && handleDesignColors[branchColor],
                              isActive && '!border-green-500 !bg-green-500',
                              isInactive &&
                                '!border-slate-300 !bg-slate-200 dark:!bg-slate-800 opacity-30',
                            )}
                            style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

        {/* Status Messages */}
        {isTimelineActive && (
          <div className="pt-2 border-t border-border/50">
            {visualState.lastEvent && (
              <div className="text-xs text-muted-foreground mt-2">
                <div className="font-medium">
                  Last: {visualState.lastEvent.type.replace('_', ' ')}
                </div>
                {visualState.lastEvent.message && (
                  <div className="truncate mt-1" title={visualState.lastEvent.message}>
                    {visualState.lastEvent.message}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Legacy status messages */}
        {!isTimelineActive && nodeData.status === 'success' && nodeData.executionTime && (
          <div className="pt-2 border-t border-border">
            <Badge
              variant="secondary"
              className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            >
              ✓ {nodeData.executionTime}ms
            </Badge>
          </div>
        )}
        {!isTimelineActive && nodeData.status === 'error' && nodeData.error && (
          <div className="pt-2 border-t border-red-200">
            <Badge
              variant="secondary"
              className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 truncate max-w-full"
              title={nodeData.error}
            >
              ✗ {nodeData.error}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
};
