import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Leadiya Lead Scraper',
    description: '2GIS lead scraper — extract company data from real browser sessions',
    version: '1.1.0',
    permissions: ['activeTab', 'scripting', 'storage', 'notifications', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
  vite: () => ({
    build: {
      rollupOptions: {
        output: {
          format: 'iife',
        },
      },
    },
  }),
})
