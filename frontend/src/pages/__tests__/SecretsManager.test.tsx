import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SecretSummary } from '@/schemas/secret';

mock.module('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: any) => (open ? <>{children}</> : null);
  const DialogContent = ({ children, ...props }: any) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const FragmentWrapper = ({ children }: any) => <>{children}</>;

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
  };
});

// Mutable mock state for TanStack Query hooks
const mockQueryState: {
  secrets: SecretSummary[];
  isLoading: boolean;
  error: Error | null;
  createSecret: any;
  updateSecret: any;
  rotateSecret: any;
  deleteSecret: any;
} = {
  secrets: [],
  isLoading: false,
  error: null,
  createSecret: mock().mockResolvedValue(undefined),
  updateSecret: mock().mockResolvedValue(undefined),
  rotateSecret: mock().mockResolvedValue(undefined),
  deleteSecret: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({
    data: mockQueryState.secrets,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useCreateSecret: () => ({
    mutateAsync: mockQueryState.createSecret,
  }),
  useUpdateSecret: () => ({
    mutateAsync: mockQueryState.updateSecret,
  }),
  useRotateSecret: () => ({
    mutateAsync: mockQueryState.rotateSecret,
  }),
  useDeleteSecret: () => ({
    mutateAsync: mockQueryState.deleteSecret,
  }),
}));

const mockInvalidateQueries = mock().mockResolvedValue(undefined);

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

import { SecretsManager } from '@/pages/SecretsManager';
import { useAuthStore, DEFAULT_ORG_ID } from '@/store/authStore';

interface MockQueryOverrides {
  secrets?: SecretSummary[];
  isLoading?: boolean;
  error?: Error | null;
  createSecret?: (...args: any[]) => Promise<SecretSummary>;
  updateSecret?: (...args: any[]) => Promise<SecretSummary>;
  rotateSecret?: (...args: any[]) => Promise<SecretSummary>;
  deleteSecret?: (...args: any[]) => Promise<void>;
}

async function resetAuthStore() {
  const persist = (useAuthStore as typeof useAuthStore & { persist?: any }).persist;
  if (persist?.clearStorage) {
    await persist.clearStorage();
  }
  useAuthStore.setState({
    token: null,
    userId: null,
    organizationId: DEFAULT_ORG_ID,
    roles: ['ADMIN'],
    provider: 'local',
  });
}

const ISO = '2024-01-01T00:00:00.000Z';

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
};

const renderSecretsManager = () =>
  render(
    <MemoryRouter>
      <SecretsManager />
    </MemoryRouter>,
  );

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.secrets = overrides.secrets ?? [baseSecret];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.createSecret = overrides.createSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.updateSecret = overrides.updateSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.rotateSecret = overrides.rotateSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.deleteSecret = overrides.deleteSecret ?? mock().mockResolvedValue(undefined);
  mockInvalidateQueries.mockClear();

  return mockQueryState;
};

const openEditDialog = async () => {
  const rows = await screen.findAllByRole('row');
  const rowElement = rows.find((row) => within(row).queryByText(baseSecret.name));
  if (!rowElement) {
    throw new Error('Unable to locate secret row for edit action');
  }
  const editButton = within(rowElement).getByRole('button', { name: 'Edit' });
  fireEvent.click(editButton);
  return await screen.findByRole('dialog');
};

describe('SecretsManager edit dialog', () => {
  beforeEach(async () => {
    cleanup();
    setupStore();
    await resetAuthStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('updates metadata without rotating when only metadata changes', async () => {
    // Ensure admin role is set for edit operations
    useAuthStore.setState({ roles: ['ADMIN'] });

    const updateSecret = mock().mockResolvedValue({
      ...baseSecret,
      name: 'Updated Secret',
    });
    const rotateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const nameInput = within(dialog).getByLabelText('Secret name');

    fireEvent.change(nameInput, { target: { value: 'Updated Secret' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await screen.findByText('Secret "Updated Secret" updated successfully.');

    expect(updateSecret).toHaveBeenCalledTimes(1);
    expect(updateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: {
        name: 'Updated Secret',
        description: 'Original secret',
        tags: ['prod', 'api'],
      },
    });
    expect(rotateSecret).not.toHaveBeenCalled();
  });

  it('rotates secret value without updating metadata when only new value is provided', async () => {
    // Ensure admin role is set for edit operations
    useAuthStore.setState({ roles: ['ADMIN'] });

    const rotateSecret = mock().mockResolvedValue(baseSecret);
    const updateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ rotateSecret, updateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const valueInput = within(dialog).getByLabelText(/New secret value/);

    fireEvent.change(valueInput, { target: { value: '  rotated-value  ' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await screen.findByText('Secret "Prod API Key" rotated successfully.');

    expect(rotateSecret).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: { value: 'rotated-value' },
    });
    expect(updateSecret).not.toHaveBeenCalled();
  });

  it('updates metadata and rotates secret value when both are provided', async () => {
    // Ensure admin role is set for edit operations
    useAuthStore.setState({ roles: ['ADMIN'] });

    const updatedSecret = {
      ...baseSecret,
      name: 'Prod API Key v2',
      updatedAt: '2024-02-01T00:00:00.000Z',
    };
    const updateSecret = mock().mockResolvedValue(updatedSecret);
    const rotateSecret = mock().mockResolvedValue(updatedSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const nameInput = within(dialog).getByLabelText('Secret name');
    const valueInput = within(dialog).getByLabelText(/New secret value/);

    fireEvent.change(nameInput, { target: { value: 'Prod API Key v2' } });
    fireEvent.change(valueInput, { target: { value: 'next-secret' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await screen.findByText('Secret "Prod API Key v2" updated and rotated successfully.');

    expect(updateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: {
        name: 'Prod API Key v2',
        description: 'Original secret',
        tags: ['prod', 'api'],
      },
    });
    expect(rotateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: { value: 'next-secret' },
    });
  });

  it('does not call update or rotate when no changes are submitted', async () => {
    // Ensure admin role is set for edit operations
    useAuthStore.setState({ roles: ['ADMIN'] });

    const updateSecret = mock().mockResolvedValue(baseSecret);
    const rotateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await screen.findByText('Secret "Prod API Key" unchanged.');

    expect(updateSecret).not.toHaveBeenCalled();
    expect(rotateSecret).not.toHaveBeenCalled();
  });
});

describe('SecretsManager role gating', () => {
  beforeEach(async () => {
    cleanup();
    setupStore();
    await resetAuthStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('disables create actions for members', async () => {
    useAuthStore.setState({ roles: ['MEMBER'] });
    renderSecretsManager();

    // Use getAllByText to handle potential multiple renders in CI, then check the first one
    const banners = await screen.findAllByText(/read-only access/i);
    expect(banners.length).toBeGreaterThan(0);
    expect(banners[0]).toBeInTheDocument();

    const createButton = await screen.findByRole('button', { name: /create secret/i });
    expect(createButton).toBeDisabled();
  });
});
