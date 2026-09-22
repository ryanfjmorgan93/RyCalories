/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
/** CI run number and short commit SHA of this build; empty strings outside CI. */
declare const __BUILD_RUN__: string;
declare const __BUILD_SHA__: string;

// vite/client.d.ts declares `?url` for common asset extensions but not `.wasm` — the zxing wasm
// binary is imported this way so it lands in dist/assets and gets a real URL instead of being
// fetched from a CDN.
declare module '*.wasm?url' {
  const src: string;
  export default src;
}
