import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  clean: true,
  shims: true,
  banner: '#!/usr/bin/env node',
  fixedExtension: false,
});
