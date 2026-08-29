import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// WHY THIS FILE CHANGED
//   @solana/web3.js drags in Node-only packages (cipher-base, readable-stream,
//   borsh, bn.js). Vite does not polyfill Node globals, so in the browser
//   `Buffer` and `process` are simply undefined. The build still succeeds —
//   Rollup only warns, as it did in the deploy log:
//
//     Module "stream" has been externalized for browser compatibility,
//     imported by node_modules/cipher-base/index.js
//
//   …and then the first module that touches Buffer throws during evaluation,
//   before React ever mounts. That is the black screen. It is a runtime fault
//   dressed as a successful deploy, which is why the build log looks clean.
//
//   `globals` is the part that actually fixes it. `include` alone provides the
//   modules but not the `Buffer` / `process` bindings the CJS deps expect.

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'events', 'util', 'crypto'],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
  ],

  server: { port: 5174 },

  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Function form rather than an object map on purpose. The object form
        // names packages explicitly and Rollup fails the build if one of them
        // is not in the graph, so it breaks whenever a dependency is swapped.
        // This partitions whatever is actually installed.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@solana') || id.includes('borsh') || id.includes('bn.js')) return 'solana';
          if (id.includes('charts') || id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('@scure') || id.includes('@noble') || id.includes('ed25519-hd-key')) return 'crypto';
          if (id.includes('react') || id.includes('scheduler')) return 'react';
        },
      },
    },
  },

  optimizeDeps: {
    // web3.js ships CJS. Pre-bundling it keeps the dev server from breaking on
    // the same missing globals after a cold start.
    include: ['@solana/web3.js', 'buffer'],
  },
});
