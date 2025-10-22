import { describe, it, beforeEach, expect } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomPanel } from '../BottomPanel'
import { useExecutionStore } from '@/store/executionStore'

const iso = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString()

const hasDom = typeof document !== 'undefined'
const describeBottomPanel = hasDom ? describe : describe.skip

describeBottomPanel('BottomPanel', () => {
  beforeEach(() => {
    useExecutionStore.getState().reset()
  })

  it('renders trace events with level badges and node reference', async () => {
    useExecutionStore.setState({
      status: 'running',
      logs: [
        {
          id: 'event-1',
          runId: 'run-1',
          nodeId: 'node-42',
          type: 'FAILED',
          level: 'error',
          timestamp: iso(),
          message: 'Node execution failed',
          error: { message: 'Boom' },
        },
        {
          id: 'event-2',
          runId: 'run-1',
          nodeId: 'node-42',
          type: 'COMPLETED',
          level: 'info',
          timestamp: iso(1),
          message: 'Recovery successful',
        },
      ],
    })

    render(<BottomPanel />)

    expect(await screen.findByText('ERROR')).toBeInTheDocument()
    expect(screen.getAllByText('[node-42]')).toHaveLength(2)
    expect(screen.getByText('Node execution failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.getByText(/No logs yet/i)).toBeInTheDocument()
  })
})
