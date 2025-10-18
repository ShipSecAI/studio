import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { WorkflowList } from '@/pages/WorkflowList'

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