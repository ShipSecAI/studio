import { useState, useRef, type ChangeEvent, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  MoreHorizontal,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkflowStore } from '@/store/workflowStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { cn } from '@/lib/utils'

interface TopBarProps {
  workflowId?: string
  selectedRunId?: string | null
  isNew?: boolean
  onRun?: () => void
  onSave: () => Promise<void> | void
  onImport?: (file: File) => Promise<void> | void
  onExport?: () => void
  canManageWorkflows?: boolean
}

const DEFAULT_WORKFLOW_NAME = 'Untitled Workflow'

export function TopBar({
  workflowId,
  selectedRunId,
  onRun,
  onSave,
  onImport,
  onExport,
  canManageWorkflows = true,
}: TopBarProps) {
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [tempWorkflowName, setTempWorkflowName] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showPencil, setShowPencil] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const { metadata, isDirty, setWorkflowName } = useWorkflowStore()
  const mode = useWorkflowUiStore((state) => state.mode)
  const canEdit = Boolean(canManageWorkflows)

  const handleChangeWorkflowName = () => {
    const trimmed = (tempWorkflowName ?? '').trim()
    if (!trimmed) {
      setWorkflowName(DEFAULT_WORKFLOW_NAME)
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME)
      setIsEditingTitle(false)
      return
    }
    if (trimmed !== metadata.name) {
      setWorkflowName(trimmed)
    }
    setIsEditingTitle(false)
  }

  const handleStartEditing = () => {
    if (!canEdit) return
    setIsEditingTitle(true)
    // Focus the input after a brief delay to ensure it's rendered
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleChangeWorkflowName()
    } else if (e.key === 'Escape') {
      setTempWorkflowName(metadata.name || DEFAULT_WORKFLOW_NAME)
      setIsEditingTitle(false)
    }
  }

  const handleSave = async () => {
    if (!canEdit) {
      return
    }
    setIsSaving(true)
    try {
      await Promise.resolve(onSave())
    } finally {
      setIsSaving(false)
    }
  }

  const handleRun = () => {
    if (!canEdit) {
      return
    }
    if (onRun) {
      onRun()
    }
  }



  const handleExport = () => {
    if (!canEdit) {
      return
    }
    if (onExport) {
      onExport()
    }
  }

  const handleImportClick = () => {
    if (!canEdit) {
      return
    }
    if (!onImport) return
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) {
      event.target.value = ''
      return
    }
    if (!onImport) return
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      setIsImporting(true)
      await onImport(file)
    } catch (error) {
      console.error('Failed to import workflow:', error)
    } finally {
      setIsImporting(false)
    }
  }

  useEffect(() => {
    if (metadata.name) {
      setTempWorkflowName(metadata.name)
    } else {
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME)
    }
  }, [metadata.name])

  const modeToggle = (
    <div className="flex rounded-lg border bg-muted/40 overflow-hidden text-xs font-medium shadow-sm flex-shrink-0">
      <Button
        variant={mode === 'design' ? 'default' : 'ghost'}
        size="sm"
        className="h-9 w-[110px] px-3 gap-2 rounded-none justify-center"
        onClick={() => {
          if (!canEdit || !workflowId) return
          // Navigate to design URL - this triggers mode update via useLayoutEffect
          navigate(`/workflows/${workflowId}`)
        }}
        disabled={!canEdit}
        aria-pressed={mode === 'design'}
      >
        <PencilLine className="h-4 w-4 flex-shrink-0" />
        <span className="flex flex-col leading-tight text-left">
          <span className="text-xs font-semibold hidden md:inline">Design</span>
          <span
            className={cn(
              'text-[10px] hidden xl:inline',
              mode === 'design' ? 'text-primary-foreground/80' : 'text-muted-foreground'
            )}
          >
            Edit workflow
          </span>
        </span>
      </Button>
      <Button
        variant={mode === 'execution' ? 'default' : 'ghost'}
        size="sm"
        className="h-9 w-[130px] px-3 gap-2 rounded-none border-l border-border/50 justify-center"
        onClick={() => {
          if (!workflowId) return
          // Navigate to execution URL - this triggers mode update via useLayoutEffect
          // If a run is selected, navigate to that specific run
          const executionPath = selectedRunId
            ? `/workflows/${workflowId}/runs/${selectedRunId}`
            : `/workflows/${workflowId}/runs`
          navigate(executionPath)
        }}
        aria-pressed={mode === 'execution'}
      >
        <MonitorPlay className="h-4 w-4 flex-shrink-0" />
        <span className="flex flex-col leading-tight text-left">
          <span className="text-xs font-semibold hidden md:inline">Execution</span>
          <span
            className={cn(
              'text-[10px] hidden xl:inline',
              mode === 'execution' ? 'text-primary-foreground/80' : 'text-muted-foreground'
            )}
          >
            Inspect executions
          </span>
        </span>
      </Button>
    </div>
  )

  const saveState = isSaving ? 'saving' : isDirty ? 'dirty' : 'clean'

  const saveLabel = saveState === 'clean' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save'
  const saveBadgeText = saveState === 'clean' ? 'Synced' : saveState === 'saving' ? 'Syncing' : 'Pending'
  const saveBadgeTone =
    saveState === 'clean'
      ? '!bg-emerald-50 !text-emerald-700 !border-emerald-300 dark:!bg-emerald-900 dark:!text-emerald-100 dark:!border-emerald-500'
      : saveState === 'saving'
        ? '!bg-blue-50 !text-blue-700 !border-blue-300 dark:!bg-blue-900 dark:!text-blue-100 dark:!border-blue-500'
        : '!bg-amber-50 !text-amber-700 !border-amber-300 dark:!bg-amber-900 dark:!text-amber-100 dark:!border-amber-500'

  const saveButtonClasses = cn(
    'gap-2 min-w-0 transition-all duration-200',
    saveState === 'clean' && 'border-emerald-200 dark:border-emerald-700',
    saveState === 'dirty' && 'border-gray-300 dark:border-gray-600',
    saveState === 'saving' && 'border-blue-300 dark:border-blue-700'
  )

  const saveIcon =
    saveState === 'clean'
      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      : saveState === 'saving'
        ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        : <Save className="h-4 w-4" />

  return (
    <div className="min-h-[60px] border-b bg-background flex flex-nowrap items-center px-4 gap-2 sm:gap-3 py-0">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/')}
        aria-label="Back to workflows"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <div className="flex-1 min-w-0">
        <div className="grid w-full gap-2 sm:gap-4 items-center grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex items-center justify-start gap-2">
            <div
              className={cn(
                'flex items-center gap-2 min-w-0 max-w-[360px]',
                isEditingTitle
                  ? 'rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 shadow-sm'
                  : 'group relative'
              )}
              onMouseEnter={() => canEdit && !isEditingTitle && setShowPencil(true)}
              onMouseLeave={() => setShowPencil(false)}
            >
              {isEditingTitle ? (
                <Input
                  ref={titleInputRef}
                  value={tempWorkflowName}
                  onChange={(e) => setTempWorkflowName(e.target.value)}
                  onBlur={handleChangeWorkflowName}
                  onKeyDown={handleKeyDown}
                  className="font-semibold bg-transparent border-none shadow-none h-7 px-0 py-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Workflow name"
                />
              ) : (
                <>
                  <h1 className="font-semibold text-base text-foreground pr-6">
                    {metadata.name || DEFAULT_WORKFLOW_NAME}
                  </h1>
                  {canEdit && showPencil && (
                    <button
                      type="button"
                      onClick={handleStartEditing}
                      className="absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/80 transition-colors"
                      aria-label="Edit workflow name"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </>
              )}
            </div>
            {metadata.currentVersion !== null && metadata.currentVersion !== undefined && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border/60">
                v{metadata.currentVersion}
              </span>
            )}
          </div>
          <div className="flex justify-center shrink-0">{modeToggle}</div>
          <div className="flex items-center justify-end gap-1.5 sm:gap-3 shrink-0">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                {mode === 'design' && (
                  <>
                    {(onImport || onExport) && (
                      <div className="hidden md:flex items-center gap-1.5 sm:gap-2">
                        {onImport && (
                          <>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="application/json"
                              className="hidden"
                              onChange={handleFileChange}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 xl:px-3 gap-2"
                              onClick={handleImportClick}
                              disabled={!canEdit || isImporting}
                              aria-label="Import workflow"
                            >
                              <Upload className="h-4 w-4" />
                              <span className="text-xs font-medium hidden lg:inline">Import</span>
                            </Button>
                          </>
                        )}
                        {onExport && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 xl:px-3 gap-2"
                            onClick={handleExport}
                            disabled={!canEdit}
                            aria-label="Export workflow"
                          >
                            <Download className="h-4 w-4" />
                            <span className="text-xs font-medium hidden lg:inline">Export</span>
                          </Button>
                        )}
                      </div>
                    )}

                    {(onImport || onExport) && (
                      <div className="flex md:hidden">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onImport && (
                              <DropdownMenuItem onClick={handleImportClick} disabled={!canEdit || isImporting}>
                                <Upload className="mr-2 h-4 w-4" />
                                <span>Import</span>
                              </DropdownMenuItem>
                            )}
                            {onExport && (
                              <DropdownMenuItem onClick={handleExport}>
                                <Download className="mr-2 h-4 w-4" />
                                <span>Export</span>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}

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
                          'hidden sm:inline-block'
                        )}
                      >
                        {saveBadgeText}
                      </span>
                    </Button>
                  </>
                )}

                <Button
                  onClick={handleRun}
                  disabled={!canEdit}
                  size="sm"
                  className="gap-2 min-w-0"
                >
                  <Play className="h-4 w-4" />
                  <span className="hidden sm:inline">Run</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
