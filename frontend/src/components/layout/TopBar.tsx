import { useState, useRef, type ChangeEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Save,
  Play,
  PencilLine,
  MonitorPlay,
  Upload,
  Download,
  CheckCircle2,
  Loader2,
  Pencil,
  MoreVertical,
  Undo2,
  Redo2,
  ExternalLink,
  Package,
  ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useAuthStore, DEFAULT_ORG_ID } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TopBarProps {
  workflowId?: string;
  selectedRunId?: string | null;
  selectedRunStatus?: string | null;
  selectedRunOrgId?: string | null;
  onRun?: () => void;
  onSave: () => Promise<void> | void;
  onImport?: (file: File) => Promise<void> | void;
  onExport?: () => void;
  onPublishTemplate?: () => void;
  canManageWorkflows?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isInWorkflowBuilder?: boolean;
  hasAnalyticsSink?: boolean;
}

const DEFAULT_WORKFLOW_NAME = 'Untitled Workflow';

export function TopBar({
  workflowId,
  selectedRunId,
  selectedRunStatus,
  selectedRunOrgId,
  isInWorkflowBuilder,
  onRun,
  onSave,
  onImport,
  onExport,
  onPublishTemplate,
  canManageWorkflows = true,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasAnalyticsSink = false,
}: TopBarProps) {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [tempWorkflowName, setTempWorkflowName] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showPencil, setShowPencil] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const { metadata, isDirty, setWorkflowName } = useWorkflowStore();
  const mode = useWorkflowUiStore((state) => state.mode);
  const organizationId = useAuthStore((s) => s.organizationId);
  const authProvider = useAuthStore((s) => s.provider);
  // For Clerk auth, org context is ready when organizationId is set to a real value (not default)
  // For other providers (local, custom), org context is always ready
  const isOrgReady = authProvider !== 'clerk' || organizationId !== DEFAULT_ORG_ID;
  const canEdit = Boolean(canManageWorkflows);

  const handleChangeWorkflowName = () => {
    const trimmed = (tempWorkflowName ?? '').trim();
    if (!trimmed) {
      setWorkflowName(DEFAULT_WORKFLOW_NAME);
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME);
      setIsEditingTitle(false);
      return;
    }
    if (trimmed !== metadata.name) {
      setWorkflowName(trimmed);
    }
    setIsEditingTitle(false);
  };

  const handleStartEditing = () => {
    if (!canEdit) return;
    setIsEditingTitle(true);
    // Focus the input after a brief delay to ensure it's rendered
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleChangeWorkflowName();
    } else if (e.key === 'Escape') {
      setTempWorkflowName(metadata.name || DEFAULT_WORKFLOW_NAME);
      setIsEditingTitle(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit) {
      return;
    }
    setIsSaving(true);
    try {
      await Promise.resolve(onSave());
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = () => {
    if (!canEdit) {
      return;
    }
    if (onRun) {
      onRun();
    }
  };

  const handleExport = () => {
    if (!canEdit) {
      return;
    }
    if (onExport) {
      onExport();
    }
  };

  const handleImportClick = () => {
    if (!canEdit) {
      return;
    }
    if (!onImport) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) {
      event.target.value = '';
      return;
    }
    if (!onImport) return;
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      setIsImporting(true);
      await onImport(file);
    } catch (error) {
      console.error('Failed to import workflow:', error);
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    if (metadata.name) {
      setTempWorkflowName(metadata.name);
    } else {
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME);
    }
  }, [metadata.name]);

  const modeToggle = (
    <div className="flex rounded-lg border bg-muted/40 overflow-hidden text-xs font-medium shadow-sm flex-shrink-0">
      <Button
        variant={mode === 'design' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 md:h-9 px-2 md:px-3 gap-1.5 md:gap-2 rounded-none"
        onClick={() => {
          if (!canEdit || !workflowId) return;
          // Navigate to design URL - this triggers mode update via useLayoutEffect
          navigate(`/workflows/${workflowId}`);
        }}
        disabled={!canEdit}
        aria-pressed={mode === 'design'}
      >
        <PencilLine className="h-4 w-4 flex-shrink-0" />
        <span className="flex flex-col leading-tight text-left">
          <span className="text-xs font-semibold hidden sm:inline">Design</span>
          <span
            className={cn(
              'text-[10px] hidden xl:inline',
              mode === 'design' ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            Edit workflow
          </span>
        </span>
      </Button>
      <Button
        variant={mode === 'execution' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 md:h-9 px-2 md:px-3 gap-1.5 md:gap-2 rounded-none border-l border-border/50"
        onClick={() => {
          if (!workflowId) return;
          // Navigate to execution URL - this triggers mode update via useLayoutEffect
          // If a run is selected, navigate to that specific run
          const executionPath = selectedRunId
            ? `/workflows/${workflowId}/runs/${selectedRunId}`
            : `/workflows/${workflowId}/runs`;
          navigate(executionPath);
        }}
        aria-pressed={mode === 'execution'}
      >
        <MonitorPlay className="h-4 w-4 flex-shrink-0" />
        <span className="flex flex-col leading-tight text-left">
          <span className="text-xs font-semibold hidden sm:inline">Execute</span>
          <span
            className={cn(
              'text-[10px] hidden xl:inline',
              mode === 'execution' ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            Inspect executions
          </span>
        </span>
      </Button>
    </div>
  );

  const saveState = isSaving ? 'saving' : isDirty ? 'dirty' : 'clean';

  const saveLabel = saveState === 'clean' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save';
  const saveBadgeText =
    saveState === 'clean' ? 'Synced' : saveState === 'saving' ? 'Syncing' : 'Pending';
  const saveBadgeTone =
    saveState === 'clean'
      ? '!bg-emerald-50 !text-emerald-700 !border-emerald-300 dark:!bg-emerald-900 dark:!text-emerald-100 dark:!border-emerald-500'
      : saveState === 'saving'
        ? '!bg-blue-50 !text-blue-700 !border-blue-300 dark:!bg-blue-900 dark:!text-blue-100 dark:!border-blue-500'
        : '!bg-amber-50 !text-amber-700 !border-amber-300 dark:!bg-amber-900 dark:!text-amber-100 dark:!border-amber-500';

  const saveButtonClasses = cn(
    'gap-2 min-w-0 transition-all duration-200',
    saveState === 'clean' && 'border-emerald-200 dark:border-emerald-700',
    saveState === 'dirty' && 'border-gray-300 dark:border-gray-600',
    saveState === 'saving' && 'border-blue-300 dark:border-blue-700',
  );

  const saveIcon =
    saveState === 'clean' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : saveState === 'saving' ? (
      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    ) : (
      <Save className="h-4 w-4" />
    );

  return (
    <div className="min-h-[56px] md:min-h-[60px] border-b bg-background flex flex-nowrap items-center px-2 md:px-4 gap-1.5 md:gap-3 py-0">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/')}
        aria-label="Back to workflows"
        className="h-9 w-9 flex-shrink-0"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <div className="flex-1 min-w-0">
        <div className="flex w-full gap-2 md:gap-4 items-center">
          {/* Workflow name - fixed width left section for consistent centering */}
          <div className="flex items-center justify-start gap-2 min-w-0 w-[140px] sm:w-[200px] md:w-[280px] lg:w-[360px] flex-shrink-0">
            <div
              className={cn(
                'flex items-center gap-2 min-w-0 max-w-[120px] sm:max-w-[180px] md:max-w-[280px] lg:max-w-[360px]',
                isEditingTitle
                  ? 'rounded-lg border border-border/60 bg-muted/40 px-2 md:px-3 py-1 md:py-1.5 shadow-sm'
                  : 'group relative cursor-pointer',
              )}
              onMouseEnter={() => canEdit && !isEditingTitle && setShowPencil(true)}
              onMouseLeave={() => setShowPencil(false)}
              onClick={() => {
                // Allow tap to edit on mobile
                if (canEdit && !isEditingTitle) {
                  handleStartEditing();
                }
              }}
            >
              {isEditingTitle ? (
                <Input
                  ref={titleInputRef}
                  value={tempWorkflowName}
                  onChange={(e) => setTempWorkflowName(e.target.value)}
                  onBlur={handleChangeWorkflowName}
                  onKeyDown={handleKeyDown}
                  className="font-semibold bg-transparent border-none shadow-none h-7 px-0 py-0 text-xs sm:text-sm md:text-base focus-visible:ring-0 focus-visible:ring-offset-0 w-full min-w-[80px]"
                  placeholder="Workflow name"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <h1 className="font-semibold text-xs sm:text-sm md:text-base text-foreground pr-0 sm:pr-6 truncate">
                    {metadata.name || DEFAULT_WORKFLOW_NAME}
                  </h1>
                  {canEdit && (
                    <Pencil
                      className={cn(
                        'h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground flex-shrink-0 transition-opacity',
                        showPencil ? 'opacity-100' : 'opacity-50 sm:opacity-0',
                      )}
                    />
                  )}
                </>
              )}
            </div>
            {metadata.currentVersion !== null && metadata.currentVersion !== undefined && (
              <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border/60 flex-shrink-0">
                v{metadata.currentVersion}
              </span>
            )}
          </div>
          {/* Mode toggle - flex-centered, won't overlap with other elements */}
          <div className="flex-1 flex justify-center min-w-0">
            <div className="flex-shrink-0">{modeToggle}</div>
          </div>
          {/* Actions on the right - fixed width to match left section for consistent centering */}
          <div className="flex items-center justify-end gap-1 md:gap-2 flex-shrink-0 w-[140px] sm:w-[200px] md:w-[280px] lg:w-[360px]">
            <div className="flex items-center gap-1 md:gap-2">
              {mode === 'design' && (
                <>
                  <Button
                    onClick={handleSave}
                    disabled={!canEdit || isSaving || saveState === 'clean'}
                    variant="outline"
                    className={saveButtonClasses}
                    size="sm"
                    title={
                      saveState === 'dirty'
                        ? 'Changes pending sync'
                        : saveState === 'saving'
                          ? 'Syncing now…'
                          : 'No pending edits'
                    }
                  >
                    {saveIcon}
                    <span className="hidden xl:inline">{saveLabel}</span>
                    <span
                      className={cn(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded border ml-0 xl:ml-1',
                        saveBadgeTone,
                        'hidden sm:inline-block',
                      )}
                    >
                      {saveBadgeText}
                    </span>
                  </Button>
                </>
              )}

              {env.VITE_OPENSEARCH_DASHBOARDS_URL &&
                workflowId &&
                (!selectedRunId || (selectedRunStatus && selectedRunStatus !== 'RUNNING')) && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 md:gap-2 min-w-0"
                            disabled={!isOrgReady || !hasAnalyticsSink}
                            onClick={() => {
                              if (!isOrgReady || !hasAnalyticsSink) return;
                              const baseUrl = env.VITE_OPENSEARCH_DASHBOARDS_URL.replace(
                                /\/+$/,
                                '',
                              );
                              // Filter by run_id if a specific run is selected, otherwise by workflow_id
                              const filterQuery = selectedRunId
                                ? `shipsec.run_id.keyword:"${selectedRunId}"`
                                : `shipsec.workflow_id.keyword:"${workflowId}"`;
                              // Use the run's backend-resolved org ID when available (matches indexed data),
                              // fall back to auth store org ID for workflow-level queries
                              const effectiveOrgId = (
                                selectedRunOrgId || organizationId
                              ).toLowerCase();
                              const orgScopedPattern = `security-findings-${effectiveOrgId}-*`;
                              // OpenSearch Data Explorer URL format
                              // Use .keyword fields for exact match filtering
                              // Use 'all time' range (1 year) since run_id is unique - no need to filter by time
                              const aParam = encodeURIComponent(
                                `(discover:(columns:!(_source),interval:auto,sort:!()),metadata:(indexPattern:'${orgScopedPattern}',view:discover))`,
                              );
                              const qParam = encodeURIComponent(
                                `(query:(language:kuery,query:'${filterQuery}'))`,
                              );
                              const gParam = encodeURIComponent(
                                '(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-1y,to:now))',
                              );
                              const url = `${baseUrl}/app/data-explorer/discover/#?_a=${aParam}&_q=${qParam}&_g=${gParam}`;
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                            <span className="hidden lg:inline">View Analytics</span>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {!hasAnalyticsSink
                          ? 'Connect analytics sink to view analytics'
                          : !isOrgReady
                            ? 'Loading organization context...'
                            : selectedRunId
                              ? 'View analytics for this run in OpenSearch Dashboards'
                              : 'View analytics for this workflow in OpenSearch Dashboards'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

              {/* Run button with dropdown for Publish */}
              <div className="flex items-center">
                <Button
                  onClick={handleRun}
                  disabled={!canEdit}
                  size="sm"
                  className="gap-1.5 md:gap-2 min-w-0 rounded-r-none"
                >
                  <Play className="h-4 w-4" />
                  <span className="hidden sm:inline">Run</span>
                </Button>
                {onPublishTemplate && isInWorkflowBuilder && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        className="px-1.5 rounded-l-none border-l border-primary-foreground/20"
                        disabled={!canEdit}
                        aria-label="More actions"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      <DropdownMenuItem onClick={onPublishTemplate} disabled={!canEdit}>
                        <Package className="mr-2 h-4 w-4" />
                        <span>Publish as Template</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Vertical three-dots menu: Undo, Redo, Import, Export */}
              {mode === 'design' && (
                <>
                  {onImport && (
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={onUndo} disabled={!canEdit || !canUndo}>
                        <Undo2 className="mr-2 h-4 w-4" />
                        <span>Undo</span>
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">⌘Z</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={onRedo} disabled={!canEdit || !canRedo}>
                        <Redo2 className="mr-2 h-4 w-4" />
                        <span>Redo</span>
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">⌘⇧Z</span>
                      </DropdownMenuItem>
                      {(onImport || onExport) && <DropdownMenuSeparator />}
                      {onImport && (
                        <DropdownMenuItem
                          onClick={handleImportClick}
                          disabled={!canEdit || isImporting}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          <span>Import</span>
                        </DropdownMenuItem>
                      )}
                      {onExport && (
                        <DropdownMenuItem onClick={handleExport} disabled={!canEdit}>
                          <Download className="mr-2 h-4 w-4" />
                          <span>Export</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
