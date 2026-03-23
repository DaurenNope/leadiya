const enabled =
  process.env.WHATSAPP_BAILEYS_ENABLED === 'true' || process.env.WHATSAPP_BAILEYS_ENABLED === '1'

if (enabled) {
  void import('./workers/whatsapp-baileys.worker.js').then(() =>
    console.log('[whatsapp] Baileys outbound worker registered (queue: whatsapp_outreach)')
  )
}
