/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" để bật mock MSW khi chạy dev (xem src/mocks/README.md). */
  readonly VITE_API_MOCKING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
