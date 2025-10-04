import { useParams } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomPanel } from '@/components/layout/BottomPanel'

export function WorkflowBuilder() {
  const { id } = useParams<{ id: string }>()
  const isNewWorkflow = id === 'new'

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar workflowId={id} isNew={isNewWorkflow} />
      
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 relative">
          <div className="absolute inset-0 bg-muted/20">
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Canvas will be here (React Flow)
            </div>
          </div>
        </main>
      </div>
      
      <BottomPanel />
    </div>
  )
}