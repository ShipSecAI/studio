import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { ToastProvider } from '@/components/ui/toast-provider'

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WorkflowList />} />
          <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
