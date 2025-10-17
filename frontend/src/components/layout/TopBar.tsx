import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Save, Play, StopCircle, PencilLine, MonitorPlay, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'

interface TopBarProps {
  workflowId?: string
  isNew?: boolean
  onRun?: () => void
  onSave?: () => void
}

export function TopBar({ onRun, onSave }: TopBarProps) {
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)

  const { metadata, isDirty, setWorkflowName } = useWorkflowStore()
  const { status, runStatus, reset } = useExecutionStore()
  const isRunning = status === 'running' || status === 'queued'
  const { mode, setMode, libraryOpen, toggleLibrary } = useWorkflowUiStore()

  const handleSave = async () => {
    if (onSave) {
      setIsSaving(true)
      try {
        await onSave()
      } finally {
        setIsSaving(false)
      }
    } else {
      setIsSaving(true)
      // TODO: Implement save logic
      setTimeout(() => setIsSaving(false), 1000)
    }
  }

  const handleRun = () => {
    if (onRun) {
      onRun()
    }
  }

  const handleStop = () => {
    reset()
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
          className="font-semibold"
          placeholder="Workflow name"
        />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <Button
          variant="ghost"
          size="icon"
          className="inline-flex"
          onClick={toggleLibrary}
          aria-label={libraryOpen ? 'Hide component library' : 'Show component library'}
        >
          {libraryOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>

        <div className="flex rounded-lg border bg-muted/40 overflow-hidden text-xs font-medium shadow-sm">
          <Button
            variant={mode === 'design' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-3 gap-2 rounded-none"
            onClick={() => setMode('design')}
            aria-pressed={mode === 'design'}
            >
            <PencilLine className="h-4 w-4" />
            <span className="flex flex-col leading-tight text-left">
              <span className="text-xs font-semibold">Design</span>
              <span className="text-[10px] text-muted-foreground">Edit workflow</span>
            </span>
          </Button>
          <Button
            variant={mode === 'review' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-3 gap-2 rounded-none border-l border-border/50"
            onClick={() => setMode('review')}
            aria-pressed={mode === 'review'}
            >
            <MonitorPlay className="h-4 w-4" />
            <span className="flex flex-col leading-tight text-left">
              <span className="text-xs font-semibold">Review</span>
              <span className="text-[10px] text-muted-foreground">Inspect executions</span>
            </span>
          </Button>
        </div>

        <div className="flex gap-2">
          {isDirty && (
            <span className="text-xs text-muted-foreground self-center">
              Unsaved changes
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving || isRunning}
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
              className="gap-2"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={handleRun}
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
    </div>
  )
}
