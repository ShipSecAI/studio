import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { MemoryRouter } from 'react-router-dom'

import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'

import { TopBar } from '../TopBar'

const iso = () => new Date().toISOString()

const resetStores = () => {
  useExecutionStore.getState().reset()
  useWorkflowStore.setState({
    metadata: { id: 'workflow-1', name: 'Demo Workflow', description: '' },
    isDirty: false,
  })
}

describe('TopBar', () => {
  beforeEach(() => {
    resetStores()
  })

  it('shows progress information when available', () => {
    useExecutionStore.setState({
      status: 'running',
      runStatus: {
        runId: 'run-1',
        workflowId: 'workflow-1',
        status: 'RUNNING',
        startedAt: iso(),
        updatedAt: iso(),
        taskQueue: 'shipsec-default',
        historyLength: 10,
        progress: { completedActions: 2, totalActions: 5 },
      },
    })

    render(
      <MemoryRouter>
        <TopBar onRun={vi.fn()} onSave={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByText('2/5 actions')).toBeInTheDocument()
  })

  it('displays failure reason when execution fails', () => {
    useExecutionStore.setState({
      status: 'failed',
      runStatus: {
        runId: 'run-1',
        workflowId: 'workflow-1',
        status: 'FAILED',
        startedAt: iso(),
        updatedAt: iso(),
        taskQueue: 'shipsec-default',
        historyLength: 3,
        failure: { reason: 'ValidationError' },
      },
    })

    render(
      <MemoryRouter>
        <TopBar onRun={vi.fn()} onSave={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByText(/Failed/)).toBeInTheDocument()
    expect(screen.getByText('ValidationError')).toBeInTheDocument()
  })
})
