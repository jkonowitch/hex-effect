import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import resolve from '@rollup/plugin-node-resolve';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}']
  },
  build: {
    rollupOptions: {
      external: ['@projects-next/infra'],
      plugins: [
        resolve({
          // pass custom options to the resolve plugin
          moduleDirectories: ['node_modules'],
          exportConditions: ['node']
        })
      ]
    }
  }
});
