import { defineConfig } from 'wxt'

const googleClientId = process.env.WXT_GOOGLE_CLIENT_ID?.trim()

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Leadiya — лиды из 2GIS',
    description:
      'Профессиональный сбор контактов компаний с 2GIS: карточки и поиск, автопилот, дособор с сайта, экспорт в Sheets, webhook, CSV.',
    version: '1.3.0',
    permissions: ['activeTab', 'scripting', 'storage', 'notifications', 'tabs', 'downloads', 'identity'],
    host_permissions: ['<all_urls>'],
    ...(googleClientId
      ? {
          oauth2: {
            client_id: googleClientId,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          },
        }
      : {}),
    action: {
      default_title: 'Leadiya — сбор лидов с 2GIS',
    },
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
