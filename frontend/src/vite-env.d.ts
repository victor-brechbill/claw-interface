/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REPOS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// PWA virtual module types
declare module "virtual:pwa-register" {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (
      registration: ServiceWorkerRegistration | undefined,
    ) => void;
    onRegisterError?: (error: unknown) => void;
  }

  export function registerSW(
    options?: RegisterSWOptions,
  ): (reloadPage?: boolean) => Promise<void>;
}

// Injected at build time from package.json
declare const __APP_VERSION__: string;
