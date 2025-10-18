import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'bun:test'

import { useExecutionStore } from '@/store/executionStore'

import { BottomPanel } from '../BottomPanel'


const iso = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString()

describe('BottomPanel', () => {
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
