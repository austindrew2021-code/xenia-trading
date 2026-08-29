import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// WHY THIS FILE CHANGED
//   @solana/web3.js drags in Node-only packages (cipher-base, readable-stream,
//   borsh, bn.js, asn1.js). Vite does not polyfill Node globals, so in the
//   browser `Buffer` and `process` are simply undefined. The build still
//   succeeds — Rollup only warns about the externalized modules — and then the
//   first module touching Buffer throws during evaluation, before React mounts.
//   That was the black screen: a runtime fault dressed as a clean deploy.
//
//   `globals` is the part that actually fixes it. `include` alone provides the
//   modules but not the `Buffer` / `process` bindings the CJS deps expect.
//
// ON manualChunks — DO NOT ADD IT BACK NAIVELY
//   An earlier version of this file split vendor code into `solana` and
//   `crypto` chunks. Rollup reported `Circular chunk: solana -> crypto ->
//   solana` and the app died at load with "Cannot access 'Zt' before
//   initialization". @solana/web3.js depends on @noble/@scure, and those reach
//   back into web3.js internals, so separating them means each chunk's
//   module-scope init waits on the other — a temporal dead zone at runtime.
//
//   The 500 kB warning is cosmetic; a chunk cycle is a white screen. If the
//   bundle size genuinely needs addressing later, do it with route-level
//   `React.lazy` on the heavy pages, not by carving up the vendor graph.

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'events', 'util', 'crypto', 'vm'],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
  ],

  server: { port: 5174 },

  build: {
    // Raised so the warning stops being noise. It is a hint, not a defect.
    chunkSizeWarningLimit: 2000,
  },

  optimizeDeps: {
    // web3.js ships CJS. Pre-bundling it keeps the dev server from breaking on
    // the same missing globals after a cold start.
    include: ['@solana/web3.js', 'buffer'],
  },
});
