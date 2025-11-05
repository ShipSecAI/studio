// Centralized access to selected Vite env vars used in the UI.
// Keep this minimal and typed; provide empty-string fallbacks so UI never breaks.

type FrontendEnv = {
  VITE_FRONTEND_BRANCH: string
  VITE_BACKEND_BRANCH: string
}

export const env: FrontendEnv = {
  VITE_FRONTEND_BRANCH: (import.meta.env.VITE_FRONTEND_BRANCH as string | undefined) ?? '',
  VITE_BACKEND_BRANCH: (import.meta.env.VITE_BACKEND_BRANCH as string | undefined) ?? '',
}

