import { defineConfig } from 'vite';

// The app code PocketBase's hook runtime (goja) needs: the quick-add parser and
// repeat logic (src/server/hooks-entry.ts), so server and app agree. Output is committed:
// server/pb_hooks/xairos_parse.js. `npm run build` and the tests regenerate it.
export default defineConfig({
  build: {
    lib: { entry: 'src/server/hooks-entry.ts', formats: ['cjs'], fileName: () => 'xairos_parse.js' },
    outDir: 'server/pb_hooks',
    emptyOutDir: false,
    target: 'es2017',
    minify: false,
    copyPublicDir: false,
    rollupOptions: { output: { banner: '// GENERATED from src/server/hooks-entry.ts by `npm run build:hooks`. Do not edit.' } },
  },
});
