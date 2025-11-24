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

  it('does not show progress information (removed for cleaner UI)', () => {
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

    // Progress information was removed for cleaner UI
    expect(screen.queryByText('2/5 actions')).not.toBeInTheDocument()
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

    // Check for the full failure message format: "Failed: ValidationError"
    // Use getAllByText to handle React StrictMode double-rendering
    const failureMessages = screen.getAllByText('Failed: ValidationError')
    expect(failureMessages.length).toBeGreaterThan(0)
    expect(failureMessages[0]).toBeInTheDocument()
  })
})
