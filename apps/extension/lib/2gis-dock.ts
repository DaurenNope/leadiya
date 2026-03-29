import { extractContextFrom2gisUrl } from './2gis-context'

const HOST_ID = 'leadiya-dock-root'

const DOCK_CSS = `
  :host { all: initial; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
  * { box-sizing: border-box; }
  .wrap {
    position: fixed;
    z-index: 2147483646;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    max-width: min(340px, calc(100vw - 32px));
  }
  .panel {
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.1);
    background: linear-gradient(165deg, rgba(18,24,32,0.97) 0%, rgba(10,14,20,0.98) 100%);
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.4),
      0 24px 48px rgba(0,0,0,0.55),
      inset 0 1px 0 rgba(255,255,255,0.06);
    padding: 12px 14px;
    color: #e8ecf1;
    backdrop-filter: blur(12px);
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .wordmark {
    font-weight: 800;
    font-size: 14px;
    letter-spacing: -0.03em;
    background: linear-gradient(90deg, #c4b5fd, #a78bfa 40%, #f472b6);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .sub {
    font-size: 10px;
    color: #8b95a5;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .icon-btn {
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04);
    color: #cbd5e1;
    border-radius: 10px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    padding: 5px 10px;
    border-radius: 999px;
    margin-bottom: 10px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(15,23,42,0.65);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
  .dot.ok { background: #34d399; box-shadow: 0 0 10px rgba(52,211,153,0.45); }
  .dot.muted { background: #64748b; }
  .cta {
    width: 100%;
    border: none;
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    color: #0a0e12;
    background: linear-gradient(180deg, #c4b5fd 0%, #8b5cf6 100%);
    box-shadow: 0 10px 24px rgba(139,92,246,0.35);
    margin-bottom: 8px;
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: none;
  }
  .cta.danger {
    background: linear-gradient(180deg, #fb7185, #e11d48);
    color: #fff;
    box-shadow: 0 10px 24px rgba(225,29,72,0.3);
  }
  .cta.ghost {
    background: rgba(255,255,255,0.06);
    color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow: none;
  }
  .hint {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.45;
    margin: 0;
  }
  .pill {
    border-radius: 999px;
    border: 1px solid rgba(167,139,250,0.35);
    background: rgba(15,23,42,0.92);
    color: #e9d5ff;
    font-weight: 800;
    font-size: 13px;
    width: 48px;
    height: 48px;
    cursor: pointer;
    box-shadow: 0 16px 40px rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: -0.02em;
  }
  .pill:hover { transform: translateY(-1px); }
  .progress {
    height: 4px;
    border-radius: 999px;
    background: rgba(148,163,184,0.25);
    overflow: hidden;
    margin-top: 8px;
  }
  .progress > i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #8b5cf6, #22d3ee);
    width: 0%;
    transition: width 0.2s ease;
  }
`

function sendMessageAsync<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(r as T)
    })
  })
}

export function mountLeadiyaDock(opts: {
  isFirm: () => boolean
  isSearch: () => boolean
  getHref: () => string
}): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(HOST_ID)) return () => {}

  let destroyed = false
  let busy = false

  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('data-leadiya', 'dock')
  const shadow = host.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = DOCK_CSS

  const wrap = document.createElement('div')
  wrap.className = 'wrap'

  shadow.append(styleEl, wrap)
  document.body.appendChild(host)

  const els = {
    badgeDot: null as HTMLSpanElement | null,
    badgeText: null as HTMLSpanElement | null,
    cta: null as HTMLButtonElement | null,
    hint: null as HTMLParagraphElement | null,
    progress: null as HTMLDivElement | null,
    progressInner: null as HTMLElement | null,
  }

  function buildExpanded() {
    wrap.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'panel'

    const brand = document.createElement('div')
    brand.className = 'brand'
    brand.innerHTML = `
      <div>
        <div class="wordmark">Leadiya</div>
        <div class="sub">Быстрый сбор</div>
      </div>
      <button type="button" class="icon-btn" title="Свернуть" data-collapse>−</button>
    `

    const badge = document.createElement('div')
    badge.className = 'badge'
    const dot = document.createElement('span')
    dot.className = 'dot'
    const btext = document.createElement('span')
    badge.append(dot, btext)
    els.badgeDot = dot
    els.badgeText = btext

    const cta = document.createElement('button')
    cta.type = 'button'
    cta.className = 'cta'
    els.cta = cta

    const hint = document.createElement('p')
    hint.className = 'hint'
    els.hint = hint

    const progress = document.createElement('div')
    progress.className = 'progress'
    const progressInner = document.createElement('i')
    progress.appendChild(progressInner)
    els.progress = progress
    els.progressInner = progressInner

    const secondary = document.createElement('button')
    secondary.type = 'button'
    secondary.className = 'cta ghost'
    secondary.textContent = 'Открыть панель'

    panel.append(brand, badge, cta, hint, progress, secondary)
    wrap.appendChild(panel)

    brand.querySelector('[data-collapse]')?.addEventListener('click', () => {
      void chrome.storage.local.set({ dockCollapsed: true })
    })

    cta.addEventListener('click', onCta)
    secondary.addEventListener('click', () => {
      void sendMessageAsync({ action: 'openDashboard' })
    })
  }

  function buildCollapsed() {
    wrap.innerHTML = ''
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'pill'
    pill.title = 'Leadiya'
    pill.textContent = 'L'
    pill.addEventListener('click', () => {
      void chrome.storage.local.set({ dockCollapsed: false })
    })
    wrap.appendChild(pill)
  }

  function pageBadge(): { dotClass: string; text: string } {
    if (opts.isFirm()) return { dotClass: 'dot ok', text: 'Карточка компании' }
    if (opts.isSearch()) return { dotClass: 'dot ok', text: 'Поиск 2GIS' }
    return { dotClass: 'dot muted', text: 'Откройте 2GIS' }
  }

  function refreshUi() {
    if (destroyed || !els.cta || !els.hint || !els.badgeDot || !els.badgeText) return

    const b = pageBadge()
    els.badgeDot.className = b.dotClass
    els.badgeText.textContent = b.text

    void sendMessageAsync<any>({ action: 'getStatus' }).then((resp) => {
      if (destroyed || !els.cta || !els.hint || !els.progress || !els.progressInner) return
      const bulkRunning = Boolean(resp?.bulkRunning)
      const done = Number(resp?.bulkDone ?? 0)
      const total = Number(resp?.bulkTotal ?? 0)
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      els.progressInner.style.width = `${pct}%`
      els.progress.style.display = bulkRunning ? 'block' : 'none'

      if (bulkRunning) {
        els.cta.className = 'cta danger'
        els.cta.disabled = false
        els.cta.textContent = 'Остановить сбор'
        els.hint.textContent = `Сбор: ${done} из ${total}`
        return
      }

      els.cta.className = 'cta'
      if (opts.isFirm()) {
        els.cta.textContent = busy ? 'Собираю…' : 'Собрать эту компанию'
        els.cta.disabled = busy
        els.hint.textContent = 'Контакты и сайт отправятся в вашу Leadiya CRM.'
      } else if (opts.isSearch()) {
        els.cta.textContent = busy ? 'Запуск…' : 'Собрать список на странице'
        els.cta.disabled = busy
        els.hint.textContent = 'Обходит карточки в выдаче и ставит лиды в очередь.'
      } else {
        els.cta.textContent = 'Откройте карточку или поиск'
        els.cta.disabled = true
        els.hint.textContent = 'Или откройте расширение на панели браузера.'
      }
    })
  }

  function onCta() {
    void sendMessageAsync<any>({ action: 'getStatus' }).then((resp) => {
      if (resp?.bulkRunning) {
        void sendMessageAsync({ action: 'stopBulk' }).then(() => refreshUi())
        return
      }

      chrome.storage.local.get(
        ['selectedCity', 'selectedCategory', 'bulkMaxPages'],
        (r) => {
          const city = (r.selectedCity as string) || 'Алматы'
          const category = (r.selectedCategory as string) || 'кафе'
          let bulkMax = typeof r.bulkMaxPages === 'number' ? r.bulkMaxPages : 3
          bulkMax = Math.max(1, Math.min(20, Math.floor(bulkMax)))

          const ctx = extractContextFrom2gisUrl(opts.getHref())

          if (opts.isFirm()) {
            busy = true
            refreshUi()
            void sendMessageAsync({ action: 'manualExtract', city: ctx.city || city, category: ctx.category })
              .finally(() => {
                busy = false
                refreshUi()
              })
          } else if (opts.isSearch()) {
            busy = true
            refreshUi()
            void sendMessageAsync({
              action: 'bulkScrape',
              city: ctx.city || city,
              category: ctx.category || category,
              maxPages: bulkMax,
            }).finally(() => {
              busy = false
              refreshUi()
            })
          }
        }
      )
    })
  }

  function applyFromStorage() {
    if (destroyed) return
    chrome.storage.local.get(['dockEnabled', 'dockCollapsed'], (r) => {
      if (destroyed) return
      if (r.dockEnabled === false) {
        wrap.style.display = 'none'
        return
      }
      wrap.style.display = 'flex'
      const collapsed = r.dockCollapsed === true
      if (collapsed) {
        buildCollapsed()
      } else {
        buildExpanded()
        refreshUi()
      }
    })
  }

  applyFromStorage()

  const poll = setInterval(() => {
    if (!destroyed && els.cta) refreshUi()
  }, 2400)

  const onStorage = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area !== 'local') return
    if ('dockEnabled' in changes || 'dockCollapsed' in changes) {
      applyFromStorage()
    }
  }
  chrome.storage.onChanged.addListener(onStorage)

  return () => {
    destroyed = true
    clearInterval(poll)
    chrome.storage.onChanged.removeListener(onStorage)
    try {
      host.remove()
    } catch {
      // already removed
    }
  }
}
