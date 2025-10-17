import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkflowList />} />
        <Route path="/workflows/:id" element={<WorkflowBuilder />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App