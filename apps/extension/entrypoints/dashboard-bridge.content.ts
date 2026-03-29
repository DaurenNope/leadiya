import { defineContentScript } from 'wxt/utils/define-content-script'

const PING = 'LEADIYA_EXTENSION_PING'
const PONG = 'LEADIYA_EXTENSION_PONG'

export default defineContentScript({
  matches: ['http://localhost:*/*', 'http://127.0.0.1:*/*'],

  main() {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      if ((data as { type?: string }).type !== PING) return

      const requestId = (data as { requestId?: string }).requestId
      window.postMessage(
        {
          type: PONG,
          requestId,
          at: Date.now(),
          from: 'leadiya-extension',
        },
        '*'
      )
    })
  },
})

