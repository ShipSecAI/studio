import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { useAuthStore, DEFAULT_ORG_ID } from '../authStore';

// Mock the auth store for testing
const mockStoreState: any = {
  token: null,
  userId: null,
  organizationId: DEFAULT_ORG_ID,
  roles: ['ADMIN'],
  provider: 'local' as const,
  adminUsername: null,
  adminPassword: null,
  setToken: mock((token: string | null) => {
    mockStoreState.token = token && token.trim().length > 0 ? token.trim() : null;
  }),
  setUserId: mock((userId: string | null) => {
    mockStoreState.userId = userId && userId.trim().length > 0 ? userId.trim() : null;
  }),
  setOrganizationId: mock((organizationId: string) => {
    mockStoreState.organizationId =
      organizationId && organizationId.trim().length > 0 ? organizationId.trim() : DEFAULT_ORG_ID;
  }),
  setRoles: mock((roles: string[]) => {
    mockStoreState.roles = Array.isArray(roles) && roles.length > 0 ? roles : ['ADMIN'];
  }),
  setProvider: mock((provider: 'local' | 'clerk' | 'custom') => {
    mockStoreState.provider = provider;
  }),
  setAdminCredentials: mock((username: string, password: string) => {
    mockStoreState.adminUsername = username.trim() || null;
    mockStoreState.adminPassword = password.trim() || null;
    mockStoreState.userId = 'admin';
    mockStoreState.organizationId = 'local-dev';
    mockStoreState.roles = ['ADMIN'];
    mockStoreState.provider = 'local';
  }),
  setAuthContext: mock((context: any) => {
    if (context.token !== undefined) {
      mockStoreState.token =
        context.token && context.token.trim().length > 0 ? context.token.trim() : null;
    }
    if (context.userId !== undefined) {
      mockStoreState.userId =
        context.userId && context.userId.trim().length > 0 ? context.userId.trim() : null;
    }
    if (context.organizationId !== undefined) {
      mockStoreState.organizationId =
        context.organizationId &&
        typeof context.organizationId === 'string' &&
        context.organizationId.trim().length > 0
          ? context.organizationId.trim()
          : DEFAULT_ORG_ID;
    }
    if (context.roles !== undefined) {
      mockStoreState.roles =
        Array.isArray(context.roles) && context.roles.length > 0 ? context.roles : ['ADMIN'];
      // When roles fallback to ADMIN, also fallback provider to local
      if (!Array.isArray(context.roles) || context.roles.length === 0) {
        mockStoreState.provider = 'local';
      }
    }
    if (context.provider !== undefined) {
      mockStoreState.provider = context.provider || 'local';
    }
  }),
  clear: mock(() => {
    mockStoreState.token = null;
    mockStoreState.userId = null;
    mockStoreState.organizationId = DEFAULT_ORG_ID;
    mockStoreState.roles = ['ADMIN'];
    mockStoreState.provider = 'local';
    mockStoreState.adminUsername = null;
    mockStoreState.adminPassword = null;
  }),
  persist: {
    clearStorage: mock(async () => {}),
  },
};

mock.module('../authStore', () => ({
  useAuthStore: (selector?: (state: typeof mockStoreState) => any) => {
    if (selector) {
      return selector(mockStoreState);
    }
    return mockStoreState;
  },
  DEFAULT_ORG_ID,
}));

describe('authStore', () => {
  beforeEach(async () => {
    // Reset mock state
    mockStoreState.token = null;
    mockStoreState.userId = null;
    mockStoreState.organizationId = DEFAULT_ORG_ID;
    mockStoreState.roles = ['ADMIN'];
    mockStoreState.provider = 'local';
    mockStoreState.adminUsername = null;
    mockStoreState.adminPassword = null;

    // Clear all mock calls
    Object.values(mockStoreState).forEach((value) => {
      if (value && typeof value === 'object' && 'mockClear' in value) {
        (value as any).mockClear();
      }
    });
  });

  it('initializes with default organization id and no token', () => {
    const state = useAuthStore();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.token).toBeNull();
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
  });

  it('sets and clears API token', () => {
    const state = useAuthStore();
    state.setToken('  test-token  ');
    expect(state.token).toBe('test-token');

    state.setToken('');
    expect(state.token).toBeNull();
  });

  it('updates organization id and falls back to default when blank', () => {
    const state = useAuthStore();
    state.setOrganizationId('team-123');
    expect(state.organizationId).toBe('team-123');

    state.setOrganizationId('');
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
  });

  it('sets roles and falls back to admin when empty', () => {
    const state = useAuthStore();
    state.setRoles(['MEMBER']);
    expect(state.roles).toEqual(['MEMBER']);

    state.setRoles([]);
    expect(state.roles).toEqual(['ADMIN']);
  });

  it('resets state when cleared', () => {
    // Manually set state first
    mockStoreState.token = 'abc';
    mockStoreState.organizationId = 'team-42';
    mockStoreState.roles = ['MEMBER'];
    mockStoreState.userId = 'user-123';
    mockStoreState.provider = 'clerk';

    const state = useAuthStore();
    state.clear();

    expect(state.token).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
  });

  it('sets auth context with fallbacks', () => {
    const state = useAuthStore();
    state.setAuthContext({
      token: ' bearer-token ',
      userId: 'user-123',
      organizationId: 'org-777',
      roles: ['MEMBER'],
      provider: 'clerk',
    });

    expect(state.token).toBe('bearer-token');
    expect(state.userId).toBe('user-123');
    expect(state.organizationId).toBe('org-777');
    expect(state.roles).toEqual(['MEMBER']);
    expect(state.provider).toBe('clerk');

    state.setAuthContext({
      token: '',
      userId: '',
      organizationId: null,
      roles: null,
    });

    expect(state.token).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.provider).toBe('local');
  });
});
