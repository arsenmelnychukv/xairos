import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/pb-setup.ts'],
    testTimeout: 20000,
  },
});
