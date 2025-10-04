import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Save, Play } from 'lucide-react'

interface TopBarProps {
  workflowId?: string
  isNew?: boolean
}

export function TopBar({ workflowId, isNew }: TopBarProps) {
  const navigate = useNavigate()
  const [workflowName, setWorkflowName] = useState(
    isNew ? 'Untitled Workflow' : `Workflow ${workflowId}`
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    // TODO: Implement save logic
    setTimeout(() => setIsSaving(false), 1000)
  }

  const handleRun = async () => {
    setIsRunning(true)
    // TODO: Implement run logic
    setTimeout(() => setIsRunning(false), 2000)
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
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="font-semibold"
          placeholder="Workflow name"
        />
      </div>

      <div className="flex gap-2 ml-auto">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="outline"
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        
        <Button
          onClick={handleRun}
          disabled={isRunning}
          className="gap-2"
        >
          <Play className="h-4 w-4" />
          {isRunning ? 'Running...' : 'Run'}
        </Button>
      </div>
    </div>
  )
}