import { create } from 'zustand'
import type { ExecutionLog } from '@/schemas/execution'
import type { NodeStatus } from '@/schemas/node'

interface ExecutionStore {
  // Current execution
  currentExecutionId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  nodeStates: Record<string, NodeStatus>
  logs: ExecutionLog[]

  // Polling
  pollingInterval: NodeJS.Timeout | null

  // Actions
  startExecution: (workflowId: string) => Promise<void>
  pollStatus: (executionId: string) => void
  stopPolling: () => void
  updateNodeState: (nodeId: string, state: NodeStatus) => void
  appendLogs: (logs: ExecutionLog[]) => void
  reset: () => void

  // Mock execution for testing without backend
  mockExecution: (workflowId: string, nodeIds: string[]) => void
}

/**
 * Execution Store
 * Manages workflow execution state and logs
 *
 * Handles polling for execution status updates from backend
 */
export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  currentExecutionId: null,
  status: 'idle',
  nodeStates: {},
  logs: [],
  pollingInterval: null,

  /**
   * Start workflow execution
   * In production, this will call the backend API
   */
  startExecution: async (workflowId: string) => {
    try {
      // TODO: Replace with actual API call when backend is ready
      // const response = await api.executions.start(workflowId)
      // const { executionId } = response

      // For now, use mock execution
      console.log('Starting execution for workflow:', workflowId)

      // Mock execution ID
      const executionId = `exec-${Date.now()}`

      set({
        currentExecutionId: executionId,
        status: 'running',
        nodeStates: {},
        logs: [],
      })

      // Start polling
      get().pollStatus(executionId)

    } catch (error) {
      console.error('Failed to start execution:', error)
      set({ status: 'failed' })
    }
  },

  /**
   * Poll execution status from backend
   */
  pollStatus: (_executionId: string) => {
    // Stop any existing polling
    get().stopPolling()

    const poll = async () => {
      try {
        // TODO: Replace with actual API call when backend is ready
        // const status = await api.executions.getStatus(_executionId)

        // For now, just check if we're still running
        const currentStatus = get().status

        if (currentStatus !== 'running') {
          get().stopPolling()
          return
        }

        // Mock status update would happen here
        // set({
        //   status: status.status,
        //   nodeStates: status.nodeResults,
        //   logs: status.logs,
        // })

      } catch (error) {
        console.error('Failed to poll execution status:', error)
        get().stopPolling()
      }
    }

    // Poll every 2 seconds
    const interval = setInterval(poll, 2000)
    set({ pollingInterval: interval })
  },

  /**
   * Stop polling for execution status
   */
  stopPolling: () => {
    const interval = get().pollingInterval
    if (interval) {
      clearInterval(interval)
      set({ pollingInterval: null })
    }
  },

  /**
   * Update individual node state
   */
  updateNodeState: (nodeId: string, state: NodeStatus) => {
    set((store) => ({
      nodeStates: {
        ...store.nodeStates,
        [nodeId]: state,
      },
    }))
  },

  /**
   * Append new logs
   */
  appendLogs: (newLogs: ExecutionLog[]) => {
    set((store) => ({
      logs: [...store.logs, ...newLogs],
    }))
  },

  /**
   * Reset execution state
   */
  reset: () => {
    get().stopPolling()
    set({
      currentExecutionId: null,
      status: 'idle',
      nodeStates: {},
      logs: [],
      pollingInterval: null,
    })
  },

  /**
   * Mock execution for testing (simulates workflow execution)
   * This will be removed once backend is integrated
   */
  mockExecution: (_workflowId: string, nodeIds: string[]) => {
    const executionId = `exec-mock-${Date.now()}`

    set({
      currentExecutionId: executionId,
      status: 'running',
      nodeStates: {},
      logs: [],
    })

    // Create mock log
    const createLog = (nodeId: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): ExecutionLog => ({
      id: `log-${Date.now()}-${Math.random()}`,
      executionId,
      nodeId,
      level,
      message,
      timestamp: new Date().toISOString(),
    })

    // Simulate execution sequence
    let currentIndex = 0

    const executeNextNode = () => {
      if (currentIndex >= nodeIds.length) {
        // Execution complete
        set({ status: 'completed' })
        get().appendLogs([createLog('', 'Workflow execution completed successfully')])
        get().stopPolling()
        return
      }

      const nodeId = nodeIds[currentIndex]

      // Set node to running
      get().updateNodeState(nodeId, 'running')
      get().appendLogs([createLog(nodeId, `Starting execution of node ${nodeId}`)])

      // Simulate execution time (1-3 seconds)
      const executionTime = 1000 + Math.random() * 2000

      setTimeout(() => {
        // Randomly succeed or fail (90% success rate)
        const success = Math.random() > 0.1

        if (success) {
          get().updateNodeState(nodeId, 'success')
          get().appendLogs([
            createLog(nodeId, `Node ${nodeId} completed successfully`, 'info'),
          ])
        } else {
          get().updateNodeState(nodeId, 'error')
          get().appendLogs([
            createLog(nodeId, `Node ${nodeId} failed with error`, 'error'),
          ])
          set({ status: 'failed' })
          get().stopPolling()
          return
        }

        currentIndex++
        executeNextNode()
      }, executionTime)
    }

    // Start execution
    executeNextNode()
  },
}))
