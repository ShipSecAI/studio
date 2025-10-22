import { describe, it, beforeEach, expect, vi } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { SecretSummary } from '@/schemas/secret'

vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: any) => (open ? <>{children}</> : null)
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

vi.mock('@/store/secretStore', () => {
  const createMockState = () => ({
    secrets: [],
    loading: false,
    error: null,
    initialized: false,
    fetchSecrets: vi.fn().mockResolvedValue(undefined),
    createSecret: vi.fn(),
    rotateSecret: vi.fn(),
    updateSecret: vi.fn(),
    deleteSecret: vi.fn(),
    getSecretById: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  })

  const store = createMockState()

  const useSecretStore = vi.fn((selector?: (state: typeof store) => unknown) => {
    if (selector) {
      return selector(store)
    }
    return store
  }) as any

  useSecretStore.__setState = (partial: Partial<typeof store>) => {
    Object.assign(store, partial)
  }

  useSecretStore.__reset = () => {
    const fresh = createMockState()
    Object.assign(store, fresh)
  }

  useSecretStore.__getState = () => store

  return { useSecretStore }
})

import { SecretsManager } from '@/pages/SecretsManager'
import { useSecretStore } from '@/store/secretStore'

type MockStoreState = {
  secrets: SecretSummary[]
  loading: boolean
  error: string | null
  initialized: boolean
  fetchSecrets: (...args: any[]) => Promise<void>
  createSecret: (...args: any[]) => Promise<SecretSummary>
  rotateSecret: (...args: any[]) => Promise<SecretSummary>
  updateSecret: (...args: any[]) => Promise<SecretSummary>
  deleteSecret: (...args: any[]) => Promise<void>
  getSecretById: (...args: any[]) => SecretSummary | undefined
  refresh: (...args: any[]) => Promise<void>
}

const useSecretStoreMock = useSecretStore as any

const ISO = '2024-01-01T00:00:00.000Z'

const baseSecret: SecretSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Prod API Key',
  description: 'Original secret',
  tags: ['prod', 'api'],
  createdAt: ISO,
  updatedAt: ISO,
  activeVersion: {
    id: '22222222-2222-2222-2222-222222222222',
    version: 2,
    createdAt: ISO,
    createdBy: 'tester',
  },
}

const renderSecretsManager = () =>
  render(
    <MemoryRouter>
      <SecretsManager />
    </MemoryRouter>
  )

const setupStore = (overrides: Partial<MockStoreState> = {}) => {
  useSecretStoreMock.__reset()
  useSecretStoreMock.mockClear()

  const state: MockStoreState = {
    secrets: [baseSecret],
    loading: false,
    error: null,
    initialized: true,
    fetchSecrets: overrides.fetchSecrets ?? vi.fn().mockResolvedValue(undefined),
    createSecret: overrides.createSecret ?? vi.fn().mockResolvedValue(baseSecret),
    rotateSecret: overrides.rotateSecret ?? vi.fn().mockResolvedValue(baseSecret),
    updateSecret: overrides.updateSecret ?? vi.fn().mockResolvedValue(baseSecret),
    deleteSecret: overrides.deleteSecret ?? vi.fn().mockResolvedValue(undefined),
    getSecretById: overrides.getSecretById ?? vi.fn(),
    refresh: overrides.refresh ?? vi.fn().mockResolvedValue(undefined),
  }

  useSecretStoreMock.__setState(state)

  return state
}

const openEditDialog = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return await screen.findByRole('dialog')
}

describe('SecretsManager edit dialog', () => {
  beforeEach(() => {
    setupStore()
  })

  it('updates metadata without rotating when only metadata changes', async () => {
    const updateSecret = vi.fn().mockResolvedValue({
      ...baseSecret,
      name: 'Updated Secret',
    })
    const rotateSecret = vi.fn().mockResolvedValue(baseSecret)

    setupStore({ updateSecret, rotateSecret })

    renderSecretsManager()

    const dialog = await openEditDialog()
    const nameInput = within(dialog).getByLabelText('Secret name')

    fireEvent.change(nameInput, { target: { value: 'Updated Secret' } })

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' })
    fireEvent.click(saveButton)

    await screen.findByText('Secret "Updated Secret" updated successfully.')

    expect(updateSecret).toHaveBeenCalledTimes(1)
    expect(updateSecret).toHaveBeenCalledWith(baseSecret.id, {
      name: 'Updated Secret',
      description: 'Original secret',
      tags: ['prod', 'api'],
    })
    expect(rotateSecret).not.toHaveBeenCalled()
  })

  it('rotates secret value without updating metadata when only new value is provided', async () => {
    const rotateSecret = vi.fn().mockResolvedValue(baseSecret)
    const updateSecret = vi.fn().mockResolvedValue(baseSecret)

    setupStore({ rotateSecret, updateSecret })

    renderSecretsManager()

    const dialog = await openEditDialog()
    const valueInput = within(dialog).getByLabelText(/New secret value/)

    fireEvent.change(valueInput, { target: { value: '  rotated-value  ' } })

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' })
    fireEvent.click(saveButton)

    await screen.findByText('Secret "Prod API Key" rotated successfully.')

    expect(rotateSecret).toHaveBeenCalledTimes(1)
    expect(rotateSecret).toHaveBeenCalledWith(baseSecret.id, { value: 'rotated-value' })
    expect(updateSecret).not.toHaveBeenCalled()
  })

  it('updates metadata and rotates secret value when both are provided', async () => {
    const updatedSecret = {
      ...baseSecret,
      name: 'Prod API Key v2',
      updatedAt: '2024-02-01T00:00:00.000Z',
    }
    const updateSecret = vi.fn().mockResolvedValue(updatedSecret)
    const rotateSecret = vi.fn().mockResolvedValue(updatedSecret)

    setupStore({ updateSecret, rotateSecret })

    renderSecretsManager()

    const dialog = await openEditDialog()
    const nameInput = within(dialog).getByLabelText('Secret name')
    const valueInput = within(dialog).getByLabelText(/New secret value/)

    fireEvent.change(nameInput, { target: { value: 'Prod API Key v2' } })
    fireEvent.change(valueInput, { target: { value: 'next-secret' } })

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' })
    fireEvent.click(saveButton)

    await screen.findByText('Secret "Prod API Key v2" updated and rotated successfully.')

    expect(updateSecret).toHaveBeenCalledWith(baseSecret.id, {
      name: 'Prod API Key v2',
      description: 'Original secret',
      tags: ['prod', 'api'],
    })
    expect(rotateSecret).toHaveBeenCalledWith(baseSecret.id, { value: 'next-secret' })
  })

  it('does not call update or rotate when no changes are submitted', async () => {
    const updateSecret = vi.fn().mockResolvedValue(baseSecret)
    const rotateSecret = vi.fn().mockResolvedValue(baseSecret)

    setupStore({ updateSecret, rotateSecret })

    renderSecretsManager()

    const dialog = await openEditDialog()

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' })
    fireEvent.click(saveButton)

    await screen.findByText('Secret "Prod API Key" unchanged.')

    expect(updateSecret).not.toHaveBeenCalled()
    expect(rotateSecret).not.toHaveBeenCalled()
  })
})
