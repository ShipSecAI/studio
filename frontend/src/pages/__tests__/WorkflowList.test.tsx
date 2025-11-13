import { describe, it, beforeEach, afterEach, afterAll, expect, vi, mock } from 'bun:test'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

mock.module('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null
  const DialogContent = ({ children, ...props }: any) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  )
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>
  const FragmentWrapper = ({ children }: any) => <>{children}</>

  return {
    Dialog,
    DialogContent,
    DialogHeader: passthrough,
    DialogFooter: passthrough,
    DialogTitle: passthroughInline,
    DialogDescription: passthroughInline,
    DialogPortal: FragmentWrapper,
    DialogOverlay: FragmentWrapper,
    DialogTrigger: FragmentWrapper,
    DialogClose: FragmentWrapper,
  }
})

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

const listMock = vi.fn()
const deleteMock = vi.fn()
const noop = vi.fn()

mock.module('@/services/api', () => {
  return {
    api: {
      workflows: {
        list: listMock,
        delete: deleteMock,
        get: noop,
        create: noop,
        update: noop,
        commit: noop,
        run: noop,
      },
    },
  }
})

import { WorkflowList } from '@/pages/WorkflowList'
import {
  DEFAULT_WORKFLOW_VIEWPORT,
  WorkflowMetadataSchema,
  type WorkflowMetadataNormalized,
} from '@/schemas/workflow'

// Mock the auth store to provide admin roles for testing
const mockAuthStore: any = {
  roles: ['ADMIN'],
  token: null,
  userId: null,
  organizationId: 'local-dev',
  provider: 'local' as const,
  adminUsername: null,
  adminPassword: null,
  setRoles: vi.fn(),
  clear: vi.fn(),
  setToken: vi.fn(),
  setUserId: vi.fn(),
  setOrganizationId: vi.fn(),
  setProvider: vi.fn(),
  setAdminCredentials: vi.fn(),
  setAuthContext: vi.fn(),
}

mock.module('@/store/authStore', () => {
  const useAuthStoreMock = ((selector: (state: typeof mockAuthStore) => any) => selector(mockAuthStore)) as any
  useAuthStoreMock.setState = (partial: any) => {
    const nextState = typeof partial === 'function' ? partial(mockAuthStore) : partial
    if (nextState && typeof nextState === 'object') {
      Object.assign(mockAuthStore, nextState)
    }
  }
  useAuthStoreMock.getState = () => mockAuthStore
  useAuthStoreMock.persist = { clearStorage: async () => {} }

  return { useAuthStore: useAuthStoreMock }
})

const ISO = '2024-01-01T00:00:00.000Z'

const makeWorkflow = (id: string, name: string): WorkflowMetadataNormalized =>
  WorkflowMetadataSchema.parse({
    id,
    name,
    description: null,
    graph: {
      nodes: [],
      edges: [],
      viewport: DEFAULT_WORKFLOW_VIEWPORT,
    },
    nodes: [],
    edges: [],
    viewport: DEFAULT_WORKFLOW_VIEWPORT,
    compiledDefinition: null,
    lastRun: null,
    runCount: 0,
    createdAt: ISO,
    updatedAt: ISO,
    currentVersionId: null,
    currentVersion: null,
  })

const renderWorkflowList = () =>
  render(
    <MemoryRouter>
      <WorkflowList />
    </MemoryRouter>
  )

describe('WorkflowList delete workflow flow', () => {
  beforeEach(() => {
    listMock.mockReset()
    deleteMock.mockReset()
    // Clean up any existing dialogs
    document.body.innerHTML = ''
  })

  afterEach(() => {
    // Clean up after each test
    document.body.innerHTML = ''
  })

  it('opens confirmation dialog with workflow details when delete is clicked', async () => {
    const workflow = makeWorkflow('11111111-1111-4111-8111-111111111111', 'Alpha Workflow')
    listMock.mockResolvedValue([workflow])
    deleteMock.mockResolvedValue(undefined)

    renderWorkflowList()

    await screen.findByText('Alpha Workflow')
    const deleteButton = screen.getByRole('button', { name: 'Delete workflow Alpha Workflow' })
    fireEvent.click(deleteButton)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Alpha Workflow')).toBeInTheDocument()
    expect(within(dialog).getByText(workflow.id)).toBeInTheDocument()
  })

  it('calls API and removes workflow from list on successful delete', async () => {
    const workflow = makeWorkflow('22222222-2222-4222-8222-222222222222', 'Beta Workflow')
    listMock.mockResolvedValue([workflow])
    deleteMock.mockResolvedValue(undefined)

    renderWorkflowList()

    await screen.findByText('Beta Workflow')
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow Beta Workflow' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete workflow' }))

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(workflow.id)
    })

    await waitFor(() => {
      expect(screen.queryByText('Beta Workflow')).not.toBeInTheDocument()
    })
  })

  it('shows error in dialog when delete fails', async () => {
    const workflow = makeWorkflow('33333333-3333-4333-8333-333333333333', 'Gamma Workflow')
    listMock.mockResolvedValue([workflow])
    deleteMock.mockRejectedValue(new Error('Delete failed'))

    renderWorkflowList()

    await screen.findByText('Gamma Workflow')
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow Gamma Workflow' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete workflow' }))

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(workflow.id)
    })

    expect(await within(dialog).findByText('Delete failed')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })
})

afterAll(() => {
  consoleErrorSpy.mockRestore()
})
