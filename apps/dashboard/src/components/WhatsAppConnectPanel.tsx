import { useEffect, useState } from 'react'
import { apiUrl } from '../apiBase'

type BusinessWa = {
  whatsapp_baileys_send?: boolean
  whatsapp_inbound_log?: boolean
}

/**
 * Объясняет два режима WhatsApp: wa.me в браузере (без сервера) и очередь Baileys (воркеры + env).
 */
export function WhatsAppConnectPanel({ compact = false }: { compact?: boolean }) {
  const [apiSend, setApiSend] = useState<boolean | null>(null)
  const [inboundLog, setInboundLog] = useState<boolean | null>(null)

  useEffect(() => {
    fetch(apiUrl('/api/outreach/business'))
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: BusinessWa) => {
        setApiSend(!!d.whatsapp_baileys_send)
        setInboundLog(!!d.whatsapp_inbound_log)
      })
      .catch(() => {
        setApiSend(false)
        setInboundLog(false)
      })
  }, [])

  if (compact) {
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 text-xs text-slate-400 leading-relaxed">
        <strong className="text-emerald-200">WhatsApp:</strong> в CRM / панели лида нажмите <strong className="text-slate-200">Открыть WhatsApp</strong> — откроется{' '}
        <code className="text-slate-500">wa.me</code> в браузере (доп. настройки не нужны).{' '}
        {apiSend === true ? (
          <span className="text-emerald-300">
            Отправка через API (Baileys) включена.
            {inboundLog ? ' Входящие дублируются в ленту активности.' : ' Журнал входящих выкл. — задайте WHATSAPP_INBOUND_LOG=true на API и воркерах, чтобы видеть ответы здесь.'}
          </span>
        ) : apiSend === false ? (
          <span>Для автоотправки с сервера включите Baileys (см. полную страницу WhatsApp).</span>
        ) : (
          <span>Проверка API…</span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/25 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-emerald-100">Как здесь устроен WhatsApp</h3>

      <div className="space-y-3 text-sm text-slate-400 leading-relaxed">
        <p>
          <strong className="text-white">1. Браузер (всегда)</strong> — в <strong className="text-slate-200">CRM</strong> или у{' '}
          <strong className="text-slate-200">лида</strong> нажмите <strong className="text-emerald-300">Открыть WhatsApp</strong>. Собирается ссылка{' '}
          <code className="text-slate-500">wa.me</code> для Web или телефона. Для этого пути в дашборде ничего «подключать» не нужно.
        </p>

        <p>
          <strong className="text-white">2. API / очередь (опционально)</strong> — кнопка <strong className="text-slate-200">В очередь (WhatsApp)</strong> видна,
          когда API настроен на Baileys: воркеры, QR в логах сервера, переменные окружения.
        </p>
      </div>

      {apiSend === true ? (
        <div className="space-y-2 text-sm font-medium text-emerald-300 border border-emerald-500/30 rounded-xl px-4 py-3 bg-emerald-500/10">
          <p>
            Отправка Baileys включена (<code className="text-emerald-200/90">WHATSAPP_BAILEYS_ENABLED</code>). Запустите воркер и держите сессию привязанной.
          </p>
          {inboundLog ? (
            <p className="text-emerald-200/90 text-xs font-normal">
              Журнал входящих включён — ответы в разделе <strong className="text-emerald-100">активность WhatsApp</strong> (также на API, чтобы UI видел статус).
            </p>
          ) : (
            <p className="text-amber-200/90 text-xs font-normal">
              Чтобы <strong className="text-amber-100">видеть ответы</strong> в приложении, задайте{' '}
              <code className="text-amber-200">WHATSAPP_INBOUND_LOG=true</code> на <strong>API и воркерах</strong>, перезапустите, выполните{' '}
              <code className="text-amber-200">db:migrate</code> для колонки <code className="text-amber-200">wa_peer</code>. Текст хранится в{' '}
              <code className="text-amber-200">outreach_log</code> — чувствительные данные.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-xs text-amber-100/90 space-y-2">
          <p className="font-semibold text-amber-100">Включить отправку через API (Baileys)</p>
          <ol className="list-decimal list-inside space-y-1 text-amber-100/80">
            <li>
              <code className="text-amber-200/90">WHATSAPP_BAILEYS_ENABLED=true</code> на сервисе <strong>API</strong> и перезапуск.
            </li>
            <li>
              Запустите <strong>apps/workers</strong>, чтобы поднялся воркер Baileys (см. в репо <code className="text-amber-200/90">whatsapp-bootstrap</code>).
            </li>
            <li>
              Смотрите логи воркера, отсканируйте QR в <strong>WhatsApp → Связанные устройства</strong>. Сессия в{' '}
              <code className="text-amber-200/90">WHATSAPP_BAILEYS_AUTH_DIR</code> (или <code className="text-amber-200/90">data/baileys-auth</code>).
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}
