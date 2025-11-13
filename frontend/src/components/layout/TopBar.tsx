import { useState, useRef, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft,
  Save,
  Play,
  Square,
  PencilLine,
  MonitorPlay,
  Upload,
  Download,
} from 'lucide-react'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
// 

interface TopBarProps {
  workflowId?: string
  isNew?: boolean
  onRun?: () => void
  onSave: () => Promise<void> | void
  onImport?: (file: File) => Promise<void> | void
  onExport?: () => void
  canManageWorkflows?: boolean
  isExecuting?: boolean
  isAutoSaving?: boolean
  runDisabled?: boolean
  canOpenExecution?: boolean
}

export function TopBar({
  onRun,
  onSave,
  onImport,
  onExport,
  canManageWorkflows = true,
  isExecuting = false,
  isAutoSaving = false,
  runDisabled = false,
  canOpenExecution = false,
}: TopBarProps) {
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { metadata, isDirty, setWorkflowName } = useWorkflowStore()
  const { status, runStatus, reset } = useExecutionStore()
  const isRunning = status === 'running' || status === 'queued'
  const { mode, setMode } = useWorkflowUiStore()
  const canEdit = Boolean(canManageWorkflows)

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

  const handleStop = () => {
    reset()
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

  return (
    <div className="h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center px-4 gap-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/')}
        aria-label="Back to workflows"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <div className="flex flex-1 max-w-3xl items-center gap-3">
        <Input
          value={metadata.name}
          onChange={(e) => setWorkflowName(e.target.value)}
          readOnly={!canEdit}
          aria-readonly={!canEdit}
          className="font-semibold border-none bg-transparent focus-visible:ring-0 focus-visible:outline-none px-2"
          placeholder="Workflow name"
        />
        {(onImport || onExport) && (
          <div className="hidden md:flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5">
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
                  className="h-8 px-2 gap-1"
                  onClick={handleImportClick}
                  disabled={!canEdit || isImporting}
                  aria-label="Import workflow"
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Import</span>
                </Button>
              </>
            )}
            {onExport && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 gap-1"
                onClick={handleExport}
                disabled={!canEdit}
                aria-label="Export workflow"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Export</span>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs font-medium shadow-sm">
          <Button
            variant={mode === 'design' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 px-2 gap-1 rounded-sm"
            onClick={() => {
              if (!canEdit) return
              setMode('design')
            }}
            disabled={!canEdit}
            aria-pressed={mode === 'design'}
          >
            <PencilLine className="h-4 w-4" />
            <span className="text-xs font-medium hidden sm:inline">Design</span>
          </Button>
          <Button
            variant={mode === 'execution' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 px-2 gap-1 rounded-sm"
            onClick={() => {
              if (!canOpenExecution) return
              setMode('execution')
            }}
            aria-pressed={mode === 'execution'}
            disabled={!canOpenExecution}
            aria-disabled={!canOpenExecution}
            title={!canOpenExecution ? 'Run the workflow at least once to view executions' : undefined}
          >
            <MonitorPlay className="h-4 w-4" />
            <span className="text-xs font-medium hidden sm:inline">Execution</span>
          </Button>
        </div>

        <div className="hidden md:flex items-center gap-2">
          {/* Save status indicators */}
          <div className="flex items-center gap-2">
            {isAutoSaving && (
              <span className="text-xs text-blue-600 animate-pulse">
                Auto-saving...
              </span>
            )}
            {isDirty && !isAutoSaving && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
            {!isDirty && !isRunning && !isAutoSaving && (
              <span className="text-xs text-green-600">
                All changes saved
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={!canEdit || isSaving || isRunning}
              variant="outline"
              className="gap-2 h-9 rounded-md bg-background hover:bg-muted/50 border-border/50"
            >
              <Save className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                {isSaving ? 'Saving...' : 'Save'}
              </span>
            </Button>
            
            {isRunning ? (
              <Button
                onClick={handleStop}
                variant="destructive"
                disabled={!canEdit}
                className="gap-2 h-9 rounded-md bg-destructive hover:bg-destructive/90"
              >
                <Square className="h-4 w-4 fill-white" />
                <span className="text-sm font-medium">Stop</span>
              </Button>
            ) : (
              <Button
                onClick={handleRun}
              disabled={!canEdit || isRunning || isExecuting || runDisabled}
                className="gap-2 h-9 rounded-md"
              >
                <Play className="h-4 w-4" />
                <span className="text-sm font-medium">Run</span>
              </Button>
            )}

            {/* Progress indicator */}
            {runStatus?.progress && (
              <span className="text-sm text-muted-foreground font-medium ml-1">
                {runStatus.progress.completedActions}/{runStatus.progress.totalActions} actions
              </span>
            )}

            {/* Status messages */}
            {status === 'queued' && (
              <span className="text-sm text-muted-foreground font-medium">
                Queued…
              </span>
            )}

            {status === 'completed' && (
              <span className="text-sm text-green-600 font-medium">
                ✓ Completed
              </span>
            )}

            {status === 'failed' && (
              <span className="text-sm text-red-600 font-medium">
                ✗ Failed
              </span>
            )}
          </div>

          {/* Failure reason */}
          {status === 'failed' && runStatus?.failure?.reason && (
            <span className="text-sm text-red-600">
              {runStatus.failure.reason}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
