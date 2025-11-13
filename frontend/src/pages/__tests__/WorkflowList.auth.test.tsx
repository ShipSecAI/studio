import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import type { components } from '@shipsec/backend-client'

import { WorkflowList } from '@/pages/WorkflowList'

type WorkflowResponseDto = components['schemas']['WorkflowResponseDto']

const mockWorkflows: WorkflowResponseDto[] = []

const listWorkflowsMock = mock(async () => mockWorkflows)

// Create mock auth store state for testing
const createMockAuthStoreState = () => ({
  roles: ['ADMIN'],
  token: null,
  userId: null,
  organizationId: 'local-dev',
  provider: 'local' as const,
  adminUsername: null,
  adminPassword: null,
  setRoles: mock(() => {}),
  clear: mock(() => {}),
  setToken: mock(() => {}),
  setUserId: mock(() => {}),
  setOrganizationId: mock(() => {}),
  setProvider: mock(() => {}),
  setAdminCredentials: mock(() => {}),
  setAuthContext: mock(() => {}),
})

let mockAuthStoreState = createMockAuthStoreState()

mock.module('@/store/authStore', () => {
  const useAuthStoreMock = ((selector?: (state: ReturnType<typeof createMockAuthStoreState>) => any) => {
    if (selector) {
      return selector(mockAuthStoreState)
    }
    return mockAuthStoreState
  }) as any

  useAuthStoreMock.setState = (partial: any) => {
    const nextState = typeof partial === 'function' ? partial(mockAuthStoreState) : partial
    if (nextState && typeof nextState === 'object') {
      mockAuthStoreState = { ...mockAuthStoreState, ...nextState }
    }
  }

  useAuthStoreMock.getState = () => mockAuthStoreState
  useAuthStoreMock.persist = { clearStorage: async () => {} }

  return {
    useAuthStore: useAuthStoreMock,
    DEFAULT_ORG_ID: 'local-dev',
  }
})

mock.module('@/services/api', () => ({
  api: {
    workflows: {
      list: listWorkflowsMock,
    },
  },
}))

async function resetAuthStore() {
  mockAuthStoreState = createMockAuthStoreState()
}

const renderList = () =>
  render(
    <MemoryRouter>
      <WorkflowList />
    </MemoryRouter>,
  )

describe('WorkflowList role gating', () => {
  beforeEach(async () => {
    await resetAuthStore()
    listWorkflowsMock.mockResolvedValue([])
    // Clean up DOM between tests
    document.body.innerHTML = ''
  })

  afterEach(() => {
    // Clean up after each test
    document.body.innerHTML = ''
  })

  it('enables workflow creation for admins', async () => {
    renderList()
    const createButton = await screen.findByRole('button', { name: /Create Workflow/i })
    expect(createButton).toBeEnabled()
  })

  it('disables workflow creation for members', async () => {
    // Change the roles for this test
    mockAuthStoreState.roles = ['MEMBER']

    renderList()
    const createButton = await screen.findByRole('button', { name: /Create Workflow/i })
    expect(createButton).toBeDisabled()
  })
})
