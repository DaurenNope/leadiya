import { env } from '@leadiya/config'

const enabled = env.WHATSAPP_BAILEYS_ENABLED === 'true' || env.WHATSAPP_BAILEYS_ENABLED === '1'

if (enabled) {
  void import('./workers/whatsapp-baileys.worker.js').then(() =>
    console.log('[whatsapp] Baileys outbound worker registered (queue: whatsapp_outreach)')
  ).catch((e) =>
    console.error('[whatsapp] Failed to load Baileys worker:', e instanceof Error ? e.message : e)
  )
} else {
  console.log('[whatsapp] Baileys disabled (WHATSAPP_BAILEYS_ENABLED is not true)')
}
