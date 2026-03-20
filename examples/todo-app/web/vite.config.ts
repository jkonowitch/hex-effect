import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import resolve from '@rollup/plugin-node-resolve';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      '@projects/infra': path.resolve(__dirname, '../contexts/@projects/infra/src/index.ts'),
      '@projects/application': path.resolve(
        __dirname,
        '../contexts/@projects/application/src/index.ts'
      ),
      '@projects/domain': path.resolve(__dirname, '../contexts/@projects/domain/src/index.ts'),
      '@hex-effect/core': path.resolve(__dirname, '../../../packages/@hex-effect/core/index.ts'),
      '@hex-effect/infra-libsql-nats': path.resolve(
        __dirname,
        '../../../packages/@hex-effect/infra-libsql-nats/src/index.ts'
      ),
      '@badges/domain': path.resolve(__dirname, '../contexts/@badges/domain/src/index.ts'),
      '@badges/application': path.resolve(
        __dirname,
        '../contexts/@badges/application/src/index.ts'
      ),
      '@badges/infra': path.resolve(__dirname, '../contexts/@badges/infra/src/index.ts')
    }
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}']
  },
  server: {
    port: 3001,
    host: '0.0.0.0'
  },
  build: {
    rollupOptions: {
      external: ['@projects/infra'],
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
