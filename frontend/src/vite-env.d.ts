/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_USER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
