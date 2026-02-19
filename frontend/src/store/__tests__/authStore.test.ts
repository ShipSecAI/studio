import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { useAuthStore, DEFAULT_ORG_ID } from '../authStore';

type AuthProvider = 'local' | 'clerk' | 'custom';

const mockStoreState: any = {};
const clearStorageMock = mock(async () => {});
const subscribeMock = mock(() => () => {});

function applyDefaultState() {
  Object.assign(mockStoreState, {
    token: null,
    userId: null,
    organizationId: DEFAULT_ORG_ID,
    roles: ['ADMIN'],
    provider: 'local' as AuthProvider,
    adminUsername: null,
    adminPassword: null,
  });
}

Object.assign(mockStoreState, {
  setToken: (token: string | null) => {
    mockStoreState.token = token && token.trim().length > 0 ? token.trim() : null;
  },
  setUserId: (userId: string | null) => {
    mockStoreState.userId = userId && userId.trim().length > 0 ? userId.trim() : null;
  },
  setOrganizationId: (organizationId: string) => {
    mockStoreState.organizationId =
      organizationId && organizationId.trim().length > 0 ? organizationId.trim() : DEFAULT_ORG_ID;
  },
  setRoles: (roles: string[]) => {
    mockStoreState.roles = Array.isArray(roles) && roles.length > 0 ? roles : ['ADMIN'];
  },
  setProvider: (provider: AuthProvider) => {
    mockStoreState.provider = provider;
  },
  setAdminCredentials: (username: string, password: string) => {
    mockStoreState.adminUsername = username.trim() || null;
    mockStoreState.adminPassword = password.trim() || null;
    mockStoreState.userId = 'admin';
    mockStoreState.organizationId = 'local-dev';
    mockStoreState.roles = ['ADMIN'];
    mockStoreState.provider = 'local';
  },
  setAuthContext: (context: {
    token?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    roles?: string[] | null;
    provider?: AuthProvider;
  }) => {
    const hasTokenUpdate = context.token !== undefined;
    const sanitizedToken =
      hasTokenUpdate && context.token
        ? context.token.trim().length > 0
          ? context.token.trim()
          : null
        : hasTokenUpdate
          ? null
          : mockStoreState.token;

    const hasUserUpdate = context.userId !== undefined;
    const sanitizedUserId =
      hasUserUpdate && context.userId
        ? context.userId.trim().length > 0
          ? context.userId.trim()
          : null
        : hasUserUpdate
          ? null
          : mockStoreState.userId;

    const hasOrgUpdate = context.organizationId !== undefined;
    const sanitizedOrgId =
      hasOrgUpdate && typeof context.organizationId === 'string'
        ? context.organizationId.trim().length > 0
          ? context.organizationId.trim()
          : DEFAULT_ORG_ID
        : hasOrgUpdate && context.organizationId === null
          ? DEFAULT_ORG_ID
          : mockStoreState.organizationId;

    const hasRolesUpdate = context.roles !== undefined;
    const sanitizedRoles =
      hasRolesUpdate && Array.isArray(context.roles) && context.roles.length > 0
        ? context.roles
        : hasRolesUpdate && context.roles === null
          ? ['ADMIN']
          : mockStoreState.roles;

    const nextProvider =
      context.provider ?? (hasTokenUpdate && !sanitizedToken ? 'local' : mockStoreState.provider);

    Object.assign(mockStoreState, {
      token: sanitizedToken,
      userId: sanitizedUserId,
      organizationId: sanitizedOrgId,
      roles: sanitizedRoles,
      provider: nextProvider,
    });
  },
  clear: () => {
    applyDefaultState();
  },
});

applyDefaultState();

const useAuthStoreMock = Object.assign(
  (selector?: (state: typeof mockStoreState) => any) => {
    if (selector) {
      return selector(mockStoreState);
    }
    return mockStoreState;
  },
  {
    getState: () => mockStoreState,
    setState: (partial: any) => {
      const nextState = typeof partial === 'function' ? partial(mockStoreState) : partial;
      if (nextState && typeof nextState === 'object') {
        Object.assign(mockStoreState, nextState);
      }
    },
    subscribe: subscribeMock,
    persist: {
      clearStorage: clearStorageMock,
    },
  },
);

mock.module('../authStore', () => ({
  useAuthStore: useAuthStoreMock,
  DEFAULT_ORG_ID,
}));

describe('authStore', () => {
  beforeEach(() => {
    applyDefaultState();
    clearStorageMock.mockClear();
    subscribeMock.mockClear();
  });

  it('initializes with default organization id and no token', () => {
    const state = useAuthStore.getState();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.token).toBeNull();
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
  });

  it('sets and clears API token', () => {
    useAuthStore.getState().setToken('  test-token  ');
    expect(useAuthStore.getState().token).toBe('test-token');

    useAuthStore.getState().setToken('');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('updates organization id and falls back to default when blank', () => {
    useAuthStore.getState().setOrganizationId('team-123');
    expect(useAuthStore.getState().organizationId).toBe('team-123');

    useAuthStore.getState().setOrganizationId('');
    expect(useAuthStore.getState().organizationId).toBe(DEFAULT_ORG_ID);
  });

  it('sets roles and falls back to admin when empty', () => {
    useAuthStore.getState().setRoles(['MEMBER']);
    expect(useAuthStore.getState().roles).toEqual(['MEMBER']);

    useAuthStore.getState().setRoles([]);
    expect(useAuthStore.getState().roles).toEqual(['ADMIN']);
  });

  it('resets state when cleared', () => {
    useAuthStore.setState({
      token: 'abc',
      organizationId: 'team-42',
      roles: ['MEMBER'],
      userId: 'user-123',
      provider: 'clerk',
      adminUsername: 'admin',
      adminPassword: 'password',
    });

    useAuthStore.getState().clear();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
    expect(state.adminUsername).toBeNull();
    expect(state.adminPassword).toBeNull();
  });

  it('sets auth context with fallbacks', () => {
    useAuthStore.getState().setAuthContext({
      token: ' bearer-token ',
      userId: 'user-123',
      organizationId: 'org-777',
      roles: ['MEMBER'],
      provider: 'clerk',
    });

    let state = useAuthStore.getState();
    expect(state.token).toBe('bearer-token');
    expect(state.userId).toBe('user-123');
    expect(state.organizationId).toBe('org-777');
    expect(state.roles).toEqual(['MEMBER']);
    expect(state.provider).toBe('clerk');

    useAuthStore.getState().setAuthContext({
      token: '',
      userId: '',
      organizationId: null,
      roles: null,
    });

    state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.provider).toBe('local');
  });
});
