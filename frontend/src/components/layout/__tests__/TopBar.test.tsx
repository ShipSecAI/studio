import { describe, it, beforeEach, expect, vi } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TopBar } from '../TopBar'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'

const iso = () => new Date().toISOString()

const resetStores = () => {
  useExecutionStore.getState().reset()
  useWorkflowStore.setState({
    metadata: {
      id: 'workflow-1',
      name: 'Demo Workflow',
      description: '',
      currentVersionId: null,
      currentVersion: null,
    },
    isDirty: false,
  })
}

const hasDom = typeof document !== 'undefined'
const describeTopBar = hasDom ? describe : describe.skip

describeTopBar('TopBar', () => {
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

    expect(screen.getAllByText(/Failed/).length).toBeGreaterThan(0)
    const failureReasons = screen.getAllByText('ValidationError')
    expect(failureReasons.length).toBeGreaterThan(0)
  })
})
