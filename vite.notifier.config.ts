import { defineConfig } from 'vite';

// The notifier sidecar (server/notifier) as one Node ESM file: dist-server/notifier.mjs.
// .mjs, not .js: the release has no package.json, and Node 18 (Debian 12) reads .js as CommonJS.
export default defineConfig({
  build: {
    ssr: 'server/notifier/cli.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: { output: { entryFileNames: 'notifier.mjs', format: 'es' } },
  },
});
