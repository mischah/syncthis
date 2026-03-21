import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary', 'lcov'],
      reportOnFailure: true,
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main/main.ts', // Electron bootstrap (app.whenReady, dock, tray setup)
      ],
    },
  },
});
