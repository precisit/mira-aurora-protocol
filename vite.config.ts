import { defineConfig } from 'vitest/config';

/**
 * Vite + Vitest configuration for Aurora Protocol.
 *
 * - `base` matches the GitHub Pages project-site path
 *   (https://precisit.github.io/mira-aurora-protocol/).
 * - Unit tests (Vitest) live in /tests and run in a plain Node environment —
 *   no DOM or WebGPU is required for the logic we cover.
 */
export default defineConfig({
  base: '/mira-aurora-protocol/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
