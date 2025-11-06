import { useState, useRef, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft,
  Save,
  Play,
  StopCircle,
  PencilLine,
  MonitorPlay,
  Upload,
  Download,
} from 'lucide-react'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { cn } from '@/lib/utils'
import { AuthSettingsButton } from '@/components/auth/AuthSettingsButton'

interface TopBarProps {
  workflowId?: string
  isNew?: boolean
  onRun?: () => void
  onSave: () => Promise<void> | void
  onImport?: (file: File) => Promise<void> | void
  onExport?: () => void
  canManageWorkflows?: boolean
}

export function TopBar({
  onRun,
  onSave,
  onImport,
  onExport,
  canManageWorkflows = true,
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
    <div className="h-[60px] border-b bg-background flex items-center px-4 gap-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/')}
        aria-label="Back to workflows"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <div className="flex-1 max-w-md">
        <Input
          value={metadata.name}
          onChange={(e) => setWorkflowName(e.target.value)}
          readOnly={!canEdit}
          aria-readonly={!canEdit}
          className="font-semibold"
          placeholder="Workflow name"
        />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <AuthSettingsButton />
        <div className="flex rounded-lg border bg-muted/40 overflow-hidden text-xs font-medium shadow-sm">
          <Button
            variant={mode === 'design' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-3 gap-2 rounded-none"
            onClick={() => {
              if (!canEdit) return
              setMode('design')
            }}
            disabled={!canEdit}
            aria-pressed={mode === 'design'}
          >
            <PencilLine className="h-4 w-4" />
            <span className="flex flex-col leading-tight text-left">
              <span className="text-xs font-semibold">Design</span>
              <span
                className={cn(
                  'text-[10px]',
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
            className="h-9 px-3 gap-2 rounded-none border-l border-border/50"
            onClick={() => setMode('execution')}
            aria-pressed={mode === 'execution'}
          >
            <MonitorPlay className="h-4 w-4" />
            <span className="flex flex-col leading-tight text-left">
              <span className="text-xs font-semibold">Execution</span>
              <span
                className={cn(
                  'text-[10px]',
                  mode === 'execution' ? 'text-primary-foreground/80' : 'text-muted-foreground'
                )}
              >
                Inspect executions
              </span>
            </span>
          </Button>
        </div>

        <div className="flex gap-2">
          {isDirty && (
            <span className="text-xs text-muted-foreground self-center">
              Unsaved changes
            </span>
          )}
          {onImport && (
            <Button
              onClick={handleImportClick}
              disabled={!canEdit || isImporting}
              variant="outline"
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {isImporting ? 'Importing…' : 'Import'}
            </Button>
          )}
          {onExport && (
            <Button
              onClick={handleExport}
              disabled={!canEdit}
              variant="outline"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!canEdit || isSaving || isRunning}
            variant="outline"
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>

          {isRunning ? (
            <Button
              onClick={handleStop}
              variant="destructive"
              disabled={!canEdit}
              className="gap-2"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={handleRun}
              disabled={!canEdit}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Run
            </Button>
          )}

          {status === 'queued' && (
            <span className="text-sm text-muted-foreground font-medium">
              Queued…
            </span>
          )}

          {runStatus?.progress && (
            <span className="text-sm text-muted-foreground font-medium">
              {runStatus.progress.completedActions}/{runStatus.progress.totalActions} actions
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
          {status === 'failed' && runStatus?.failure?.reason && (
            <span className="text-sm text-red-600">
              {runStatus.failure.reason}
            </span>
          )}
        </div>
      </div>
      {onImport && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      )}
    </div>
  )
}
