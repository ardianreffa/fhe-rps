import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Settings follow the official CoFHE SDK web example.
const isolationHeaders = {
  // Lets the FHE encryption (WASM) use multiple threads in the browser.
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [wasm()],
  server: { port: 5173, headers: isolationHeaders },
  preview: { port: 4173, headers: isolationHeaders },
  optimizeDeps: {
    exclude: ['tfhe'],
    esbuildOptions: { target: 'esnext' },
  },
  assetsInclude: ['**/*.wasm'],
  define: { global: 'globalThis' },
  worker: { format: 'es' },
  build: { target: 'esnext', outDir: 'dist' },
});
