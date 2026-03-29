import { useExtensionStatus } from '../context/ExtensionStatusContext'

export function ExtensionHub() {
  const status = useExtensionStatus()

  return (
    <div className="animate-fade-in max-w-4xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100 tracking-tight">Расширение Chrome</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Панель опрашивает установленное расширение прямо в этой вкладке (postMessage). При связи дашборд и расширение работают в одном потоке.
          </p>
        </div>
        <div
          title="Прямой ping моста расширения в этой вкладке"
          className={`px-4 py-2.5 rounded-xl border text-sm font-medium flex items-center gap-2 shrink-0 ${
            status === 'connected'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : 'bg-slate-800/80 border-white/10 text-slate-400'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          {status === 'checking' ? 'Проверка…' : status === 'connected' ? 'Подключено' : 'Нет связи'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="crm-panel p-6 rounded-2xl border border-white/[0.08]">
          <h3 className="text-sm font-semibold text-slate-200">Установка (режим разработчика)</h3>
          <ol className="mt-4 space-y-3 text-sm text-slate-400 list-decimal list-inside">
            <li>Откройте <code className="text-slate-500">chrome://extensions</code></li>
            <li>Включите «Режим разработчика»</li>
            <li>Нажмите «Загрузить распакованное» и выберите папку <code className="text-slate-500">apps/extension</code> в репозитории</li>
            <li>Откройте дашборд в том же профиле Chrome и оставьте расширение включённым</li>
          </ol>
          <p className="mt-4 text-xs text-slate-600 leading-relaxed">
            Если мост активен на этой странице, статус станет <strong className="text-slate-500">Подключено</strong> автоматически.
          </p>
        </div>

        <div className="crm-panel p-6 rounded-2xl border border-white/[0.08]">
          <h3 className="text-sm font-semibold text-slate-200">Состояние моста</h3>
          <div className="mt-6 min-h-[140px] rounded-xl border border-white/[0.06] bg-slate-950/50 flex items-center justify-center p-6">
            {status === 'connected' ? (
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                  <svg className="text-emerald-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p className="text-sm text-slate-300">Расширение ответило в этой вкладке.</p>
                <p className="text-xs text-slate-500">Интерфейс и расширение связаны.</p>
              </div>
            ) : (
              <div className="text-center space-y-2 text-slate-500">
                <p className="text-sm">Нет ответа расширения на этой странице.</p>
                <p className="text-xs">Перезагрузите расширение и обновите вкладку дашборда.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
