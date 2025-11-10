import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_ORG_ENV = (import.meta as any)?.env?.VITE_DEFAULT_ORG
export const DEFAULT_ORG_ID = typeof DEFAULT_ORG_ENV === 'string' && DEFAULT_ORG_ENV.trim().length > 0
  ? DEFAULT_ORG_ENV.trim()
  : 'local-dev'

export type AuthProvider = 'local' | 'clerk' | 'custom'

interface AuthState {
  token: string | null
  userId: string | null
  organizationId: string
  roles: string[]
  provider: AuthProvider
  adminUsername: string | null
  adminPassword: string | null
  setToken: (token: string | null) => void
  setOrganizationId: (orgId: string) => void
  setRoles: (roles: string[]) => void
  setUserId: (userId: string | null) => void
  setProvider: (provider: AuthProvider) => void
  setAdminCredentials: (username: string, password: string) => void
  setAuthContext: (context: {
    token?: string | null
    userId?: string | null
    organizationId?: string | null
    roles?: string[] | null
    provider?: AuthProvider
  }) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      organizationId: DEFAULT_ORG_ID,
      provider: 'local',
      setToken: (token) =>
        set({
          token: token && token.trim().length > 0 ? token.trim() : null,
        }),
      setUserId: (userId) => set({ userId: userId && userId.trim().length > 0 ? userId.trim() : null }),
      setOrganizationId: (orgId) =>
        set({
          organizationId: orgId && orgId.trim().length > 0 ? orgId.trim() : DEFAULT_ORG_ID,
        }),
      setRoles: (roles) => set({ roles: Array.isArray(roles) && roles.length > 0 ? roles : ['ADMIN'] }),
      setProvider: (provider) => set({ provider }),
      adminUsername: null,
      adminPassword: null,
      setAdminCredentials: (username, password) =>
        set({
          adminUsername: username.trim() || null,
          adminPassword: password.trim() || null,
          userId: 'admin',
          organizationId: 'local-dev', // Lock to local-dev for local auth
          roles: ['ADMIN'],
          provider: 'local',
        }),
      setAuthContext: (context) =>
        set((current) => {
          const hasTokenUpdate = context.token !== undefined
          const sanitizedToken =
            hasTokenUpdate && context.token
              ? context.token.trim().length > 0
                ? context.token.trim()
                : null
              : hasTokenUpdate
              ? null
              : current.token

          const hasUserUpdate = context.userId !== undefined
          const sanitizedUserId =
            hasUserUpdate && context.userId
              ? context.userId.trim().length > 0
                ? context.userId.trim()
                : null
              : hasUserUpdate
              ? null
              : current.userId

          const hasOrgUpdate = context.organizationId !== undefined
          const sanitizedOrgId =
            hasOrgUpdate && typeof context.organizationId === 'string'
              ? context.organizationId.trim().length > 0
                ? context.organizationId.trim()
                : DEFAULT_ORG_ID
              : hasOrgUpdate && context.organizationId === null
              ? DEFAULT_ORG_ID
              : current.organizationId

          const hasRolesUpdate = context.roles !== undefined
          const sanitizedRoles =
            hasRolesUpdate && Array.isArray(context.roles) && context.roles.length > 0
              ? context.roles
              : hasRolesUpdate && context.roles === null
              ? ['ADMIN']
              : current.roles

          const nextProvider =
            context.provider ??
            (hasTokenUpdate && !sanitizedToken ? 'local' : current.provider)

          console.log('[AuthStore] setAuthContext called:', {
            context,
            currentRoles: current.roles,
            sanitizedRoles,
            hasRolesUpdate,
          })

          return {
            token: sanitizedToken,
            userId: sanitizedUserId,
            organizationId: sanitizedOrgId,
            roles: sanitizedRoles,
            provider: nextProvider,
          }
        }),
      roles: ['ADMIN'],
      clear: () =>
        set({
          token: null,
          userId: null,
          organizationId: DEFAULT_ORG_ID,
          roles: ['ADMIN'],
          provider: 'local',
          adminUsername: null,
          adminPassword: null,
        }),
    }),
    {
      name: 'shipsec-auth',
      version: 3,
      migrate: (persistedState, version) => {
        if (!persistedState) {
          return persistedState
        }
        if (version < 2) {
          const nextState = {
            ...persistedState,
            adminUsername: null,
            adminPassword: null,
          }
          return nextState
        }
        return persistedState
      },
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
        organizationId: state.organizationId,
        roles: state.roles,
        provider: state.provider,
        adminUsername: state.adminUsername,
        adminPassword: state.adminPassword,
      }),
    },
  ),
)
