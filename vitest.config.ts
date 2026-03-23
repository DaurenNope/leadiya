import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    testTimeout: 15000,
    pool: 'forks',
    // Allow vi.mock to replace packages that would otherwise be externalized.
    server: {
      deps: {
        inline: ['@hono/node-server'],
      },
    },
  },
})
