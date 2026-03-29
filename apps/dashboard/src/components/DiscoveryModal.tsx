import { useMemo, useState } from 'react';
import { TWOGIS_DEFAULT_CATEGORIES } from '@leadiya/types';

interface DiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (payload: {
    cities: string[];
    categories: string[];
    skipProxy?: boolean;
    /** false = show Chromium window (dev; server needs display / Xvfb). Default true. */
    headless?: boolean;
  }) => void;
}

const CITIES = [
  'Алматы', 'Астана', 'Шымкент', 'Актобе', 'Караганда', 
  'Тараз', 'Усть-Каменогорск', 'Костанай', 'Павлодар'
];

const PRESET_CATEGORIES = [...TWOGIS_DEFAULT_CATEGORIES];

function parseCategoryTokens(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function DiscoveryModal({ isOpen, onClose, onLaunch }: DiscoveryModalProps) {
  const [selectedCities, setSelectedCities] = useState<string[]>(['Алматы']);
  const [selectedPresets, setSelectedPresets] = useState<string[]>(['Рестораны']);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  /** Same as benchmark `skipProxy` — bypasses SMARTPROXY_* when 2GIS hangs behind residential IP. */
  const [skipProxy, setSkipProxy] = useState(true);
  /** When true, Playwright uses headless: false — you see the browser on the API host; logs also list URLs. */
  const [showBrowser, setShowBrowser] = useState(false);

  const mergedCategories = useMemo(() => {
    // UI intentionally enforces exactly one category (preset OR custom).
    const custom = customCategories[0]?.trim()
    if (custom) return [custom]
    const preset = selectedPresets[0]?.trim()
    return preset ? [preset] : []
  }, [selectedPresets, customCategories]);

  if (!isOpen) return null;

  const toggleCity = (city: string) => {
    // UI intentionally enforces exactly one city.
    setSelectedCities([city]);
  };

  const togglePreset = (cat: string) => {
    // Choosing a preset clears custom; UI enforces exactly one category.
    setCustomCategories([])
    setSelectedPresets([cat])
  };

  const addCustomFromInput = () => {
    const next = parseCategoryTokens(customInput)
    const first = next[0]
    if (!first) return
    // Choosing a custom category clears presets; UI enforces exactly one category.
    setSelectedPresets([])
    setCustomCategories([first])
    setCustomInput('')
  };

  const removeCustom = (cat: string) => {
    void cat
    setCustomCategories([])
  };

  const handleLaunch = async () => {
    // Defensive: keep payload strictly 1×1 even if state changes.
    const city = selectedCities[0]
    const category = mergedCategories[0]
    if (!city || !category) return;
    setIsLaunching(true);
    try {
      await onLaunch({
        cities: [city],
        categories: [category],
        ...(skipProxy ? { skipProxy: true } : {}),
        headless: !showBrowser,
      });
      onClose();
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-fade-in"
        onClick={onClose}
      />
      
      <div className="relative w-full max-w-2xl glass-card rounded-[2.5rem] shadow-2xl overflow-hidden animate-fade-in border-brand-500/10">
        <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Новая задача сбора 2GIS</h2>
            <p className="text-slate-500 text-sm mt-1">
              Выбор города и категории. API запускает Playwright на сервере — закрепите запуск кнопкой <strong className="text-slate-400">Следить</strong> в разделе задач 2GIS;
              баннер обновляется каждые несколько секунд, пока задача идёт.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-slate-900 border border-white/5 rounded-xl text-slate-500 hover:text-white transition-all active:scale-90"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="p-10 space-y-10 max-h-[60vh] overflow-y-auto">
          {/* Cities Section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <label className="text-xs font-semibold text-slate-400">Города</label>
              <div className="px-3 py-1 bg-brand-500/10 rounded-lg border border-brand-500/20 text-[10px] font-bold text-brand-400">
                Выбран 1
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CITIES.map(city => (
                <button
                  key={city}
                  onClick={() => toggleCity(city)}
                  className={`px-4 py-3 rounded-2xl text-[11px] font-bold text-left transition-all border flex items-center justify-between group ${
                    selectedCities.includes(city)
                    ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                    : 'bg-slate-950/50 border-white/5 text-slate-500 hover:border-white/10'
                  }`}
                >
                  {city}
                  <div className={`w-1.5 h-1.5 rounded-full transition-all ${
                    selectedCities.includes(city) ? 'bg-brand-400 shadow-pulse scale-100' : 'bg-slate-800 scale-0 group-hover:scale-75'
                  }`} />
                </button>
              ))}
            </div>
          </section>

          {/* Categories Section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <label className="text-xs font-semibold text-slate-400">Категории</label>
              <div className="px-3 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-[10px] font-bold text-indigo-400">
                {mergedCategories.length > 0 ? 'Выбрана 1' : 'Не выбрано'}
              </div>
            </div>

            <div className="mb-6 space-y-3">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Свой запрос</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomFromInput();
                    }
                  }}
                  placeholder="Например: университеты, ветклиники"
                  className="flex-1 px-4 py-3 rounded-2xl text-[11px] font-medium bg-slate-950/50 border border-white/10 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/30"
                />
                <button
                  type="button"
                  onClick={addCustomFromInput}
                  className="px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-slate-800 border border-white/10 text-slate-300 hover:bg-slate-700 hover:text-white transition-all shrink-0"
                >
                  Добавить
                </button>
              </div>
              <p className="text-[9px] text-slate-600 font-medium leading-relaxed">
                Несколько фраз: через запятую, точку с запятой или с новой строки. Свой запрос заменяет выбранный пресет.
                Формулируйте запрос так же, как в поиске на 2GIS (русский/казахский обычно совпадают с рубриками).
              </p>
              {customCategories.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {customCategories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1.5 rounded-xl text-[10px] font-bold bg-amber-500/15 border border-amber-500/25 text-amber-200/90"
                    >
                      {cat}
                      <button
                        type="button"
                        onClick={() => removeCustom(cat)}
                        className="p-1 rounded-lg text-amber-400/80 hover:bg-amber-500/20 hover:text-amber-100 transition-colors"
                        aria-label={`Удалить ${cat}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {PRESET_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => togglePreset(cat)}
                  className={`px-4 py-3 rounded-2xl text-[11px] font-bold text-left transition-all border flex items-center justify-between group ${
                    selectedPresets.includes(cat)
                    ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                    : 'bg-slate-950/50 border-white/5 text-slate-500 hover:border-white/10'
                  }`}
                >
                  {cat}
                  <div className={`w-1.5 h-1.5 rounded-full transition-all ${
                    selectedPresets.includes(cat) ? 'bg-brand-400 shadow-pulse scale-100' : 'bg-slate-800 scale-0 group-hover:scale-75'
                  }`} />
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="p-10 bg-white/[0.02] border-t border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-3 max-w-xl">
            <label className="flex items-start gap-3 cursor-pointer text-left">
              <input
                type="checkbox"
                checked={skipProxy}
                onChange={(e) => setSkipProxy(e.target.checked)}
                className="mt-1 rounded border-white/20 bg-slate-950"
              />
              <span className="text-xs text-slate-400 leading-snug">
                <strong className="text-slate-300">Прямое подключение</strong> — без SmartProxy (локально/дев или когда скрапер зависает за прокси).
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer text-left">
              <input
                type="checkbox"
                checked={showBrowser}
                onChange={(e) => setShowBrowser(e.target.checked)}
                className="mt-1 rounded border-white/20 bg-slate-950"
              />
              <span className="text-xs text-slate-400 leading-snug">
                <strong className="text-slate-300">Показать окно браузера</strong> — Playwright с{' '}
                <code className="text-slate-500">headless: false</code> на машине, где крутится API (нужен дисплей или Xvfb). В логах API также видны URL (
                <code className="text-slate-500">TWOGIS_LOG_NAVIGATION=1</code> для headless).
              </span>
            </label>
            <p className="text-xs text-slate-500">
              Одновременно на API может идти только одна задача 2GIS. Большие матрицы долгие — смотрите баннер статуса на главном экране.
            </p>
          </div>
          <div className="flex gap-4 justify-end">
            <button 
              onClick={handleLaunch}
              disabled={isLaunching || mergedCategories.length === 0}
              className="bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3.5 rounded-2xl text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 active:scale-[0.98]"
            >
              {isLaunching ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Запуск…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Запустить
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
