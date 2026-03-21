import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  build: {
    // Absolute path so Vite doesn't resolve it relative to `root` ('src/renderer').
    // The VitePlugin's packager ignore only includes '/.vite/**', so the output
    // must land at <project_root>/.vite/renderer/dashboard — not src/renderer/.vite/…
    outDir: resolve(__dirname, '.vite/renderer/dashboard'),
    emptyOutDir: true,
  },
});
