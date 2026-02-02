// Centralized access to selected Vite env vars used in the UI.
// Keep this minimal and typed; provide empty-string fallbacks so UI never breaks.

interface FrontendEnv {
  VITE_FRONTEND_BRANCH: string;
  VITE_BACKEND_BRANCH: string;
  VITE_GIT_SHA: string;
  VITE_LOGO_DEV_PUBLIC_KEY: string;
  VITE_ENABLE_CONNECTIONS: boolean;
  VITE_ENABLE_IT_OPS: boolean;
  VITE_API_URL: string;
}

export const env: FrontendEnv = {
  VITE_FRONTEND_BRANCH: (import.meta.env.VITE_FRONTEND_BRANCH as string | undefined) ?? '',
  VITE_BACKEND_BRANCH: (import.meta.env.VITE_BACKEND_BRANCH as string | undefined) ?? '',
  VITE_GIT_SHA: (import.meta.env.VITE_GIT_SHA as string | undefined) ?? '',
  VITE_LOGO_DEV_PUBLIC_KEY: (import.meta.env.VITE_LOGO_DEV_PUBLIC_KEY as string | undefined) ?? '',
  VITE_ENABLE_CONNECTIONS: import.meta.env.VITE_ENABLE_CONNECTIONS === 'true',
  VITE_ENABLE_IT_OPS: import.meta.env.VITE_ENABLE_IT_OPS === 'true',
  VITE_API_URL: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
};
