import { useMemo, useState } from 'react';
import { TWOGIS_DEFAULT_CATEGORIES } from '@leadiya/types';

interface DiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (payload: { cities: string[]; categories: string[] }) => void;
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

  const mergedCategories = useMemo(() => {
    const set = new Set<string>([...selectedPresets, ...customCategories]);
    return [...set];
  }, [selectedPresets, customCategories]);

  if (!isOpen) return null;

  const toggleCity = (city: string) => {
    setSelectedCities(prev => 
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  };

  const togglePreset = (cat: string) => {
    setSelectedPresets(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const addCustomFromInput = () => {
    const next = parseCategoryTokens(customInput);
    if (next.length === 0) return;
    setCustomCategories((prev) => {
      const s = new Set(prev);
      for (const t of next) s.add(t);
      return [...s];
    });
    setCustomInput('');
  };

  const removeCustom = (cat: string) => {
    setCustomCategories((prev) => prev.filter((c) => c !== cat));
  };

  const handleLaunch = async () => {
    if (selectedCities.length === 0 || mergedCategories.length === 0) return;
    setIsLaunching(true);
    try {
      await onLaunch({ cities: selectedCities, categories: mergedCategories });
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
            <h2 className="text-2xl font-black tracking-tight premium-gradient-text uppercase">Sync Engine Config</h2>
            <p className="text-slate-500 text-[10px] mt-1 font-black uppercase tracking-widest italic opacity-60">Intelligence Parameterization</p>
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
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Target Jurisdictions</label>
              <div className="px-3 py-1 bg-brand-500/10 rounded-lg border border-brand-500/20 text-[9px] font-black text-brand-400 uppercase tracking-widest">
                {selectedCities.length} Regions
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
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Industry Verticals</label>
              <div className="px-3 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-[9px] font-black text-indigo-400 uppercase tracking-widest">
                {mergedCategories.length} Segments
              </div>
            </div>

            <div className="mb-6 space-y-3">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Custom queries</label>
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
                  placeholder="Например: ветеринарные клиники, коворкинг"
                  className="flex-1 px-4 py-3 rounded-2xl text-[11px] font-medium bg-slate-950/50 border border-white/10 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/30"
                />
                <button
                  type="button"
                  onClick={addCustomFromInput}
                  className="px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-slate-800 border border-white/10 text-slate-300 hover:bg-slate-700 hover:text-white transition-all shrink-0"
                >
                  Add
                </button>
              </div>
              <p className="text-[9px] text-slate-600 font-medium leading-relaxed">
                Several terms at once: separate with comma, semicolon, or new line. Custom terms are merged with selected presets.
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
                        aria-label={`Remove ${cat}`}
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

        <div className="p-10 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
             <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Engine Ready</span>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={handleLaunch}
              disabled={isLaunching || selectedCities.length === 0 || mergedCategories.length === 0}
              className="bg-white text-black hover:bg-brand-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] shadow-2xl transition-all flex items-center gap-3 active:scale-[0.98]"
            >
              {isLaunching ? (
                <>
                  <div className="w-3 h-3 border-2 border-slate-950/20 border-t-slate-950 rounded-full animate-spin" />
                  INIT_SEQUENCE...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m12 14 4-4-4-4"/><path d="M3 3.44a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1"/><path d="M3 11.41a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1"/><path d="M3 19.38a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1"/><path d="M12 10V6"/><path d="M12 14v4"/><path d="M21 12h-5"/></svg>
                  ENGAGE_SYNC
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
