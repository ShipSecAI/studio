/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_USER_ID?: string;

  // Build-time feature flags — used for tree-shaking disabled features
  readonly VITE_FF_WORKFLOWS?: string;
  readonly VITE_FF_AI_AGENT?: string;
  readonly VITE_FF_GITHUB?: string;
  readonly VITE_FF_CLOUD?: string;
  readonly VITE_FF_ASM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
