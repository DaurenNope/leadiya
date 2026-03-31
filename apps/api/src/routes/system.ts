import { Hono } from 'hono'
import { env, isWhatsappInboundLogEnabled } from '@leadiya/config'
import type { AppEnv } from '../types.js'

const systemRouter = new Hono<AppEnv>()

/** Operator / Hermes: what is configured (no secrets). */
systemRouter.get('/capabilities', (c) => {
  return c.json({
    agentBridge: {
      configured: Boolean(env.LEADIYA_AGENT_SERVICE_KEY?.trim()),
      headerName: 'X-Leadiya-Service-Key',
    },
    auth: {
      bypass: env.AUTH_BYPASS === 'true',
    },
    integrations: {
      whatsappBaileysSend:
        env.WHATSAPP_BAILEYS_ENABLED === 'true' || env.WHATSAPP_BAILEYS_ENABLED === '1',
      whatsappInboundLog: isWhatsappInboundLogEnabled(),
      resendEmail: Boolean(env.RESEND_API_KEY?.trim()),
    },
    nodeEnv: env.NODE_ENV,
  })
})

export { systemRouter }
