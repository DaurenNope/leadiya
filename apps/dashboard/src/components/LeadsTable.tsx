import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Lead } from '../types'
import { useToast } from '../hooks/useToast'
import { useExtensionStatus } from '../context/ExtensionStatusContext'
import { apiUrl, authFetch } from '../apiBase'
import { leadStatusLabel } from '../lib/lead-ui'
import { formatAddedAt, type FiltersMeta, type SortKey, type SortOrder } from '../lib/leads-table-types'
import { LeadReachSummary, LeadTableSkeletonRows, SourceBadge, StatusBadge } from './leads-table-chrome'

/** Vite `define` in development — see vite.config.ts */
function devApiBackendHint(): string {
  const t = __LEADIYA_DEV_PROXY_TARGET__
  return typeof t === 'string' && t.length > 0 ? t : __LEADIYA_DEFAULT_API_ORIGIN__
}

interface LeadsTableProps {
  onLeadClick?: (lead: Lead) => void;
  /** Increment to refetch the current page (e.g. after a scraper finishes). */
  refreshNonce?: number;
  /** Filter to leads saved under this 2GIS scraper run (raw_data.twogisScraperRunId). */
  scraperRunIdFilter?: string | null;
  onClearScraperRunFilter?: () => void;
}

export function LeadsTable({
  onLeadClick,
  refreshNonce = 0,
  scraperRunIdFilter = null,
  onClearScraperRunFilter,
}: LeadsTableProps) {
  const { toast } = useToast();
  const extensionStatus = useExtensionStatus();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [listHydrated, setListHydrated] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersMeta, setFiltersMeta] = useState<FiltersMeta | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; order: SortOrder }>({ key: 'createdAt', order: 'desc' });
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCity, setFilterCity] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterIcp, setFilterIcp] = useState<string>('all');

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [claimingCrm, setClaimingCrm] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  /** Ignore stale JSON when filters/page change faster than the network. */
  const fetchGenerationRef = useRef(0);
  /** When true, next list fetch also loads filter dropdown facets (one round-trip via `includeFiltersMeta`). */
  const needFiltersMetaRef = useRef(true);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    if (refreshNonce > 0) needFiltersMetaRef.current = true;
  }, [refreshNonce]);

  const sourceOptions = useMemo(() => {
    const m = filtersMeta?.sources?.length ? [...filtersMeta.sources] : [];
    const seen = new Set(m.map((x) => x.value));
    for (const fallback of ['2gis', '2gis-extension', 'manual']) {
      if (!seen.has(fallback)) {
        m.push({ value: fallback, count: 0 });
        seen.add(fallback);
      }
    }
    return m.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [filtersMeta]);

  const statusOptions = useMemo(() => {
    const m = filtersMeta?.statuses?.length ? [...filtersMeta.statuses] : [];
    const seen = new Set(m.map((x) => x.value));
    for (const fallback of ['new', 'valid', 'enriched', 'failed', 'archived']) {
      if (!seen.has(fallback)) {
        m.push({ value: fallback, count: 0 });
        seen.add(fallback);
      }
    }
    return m.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [filtersMeta]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterCity !== 'all') n++;
    if (filterCategory !== 'all') n++;
    if (filterSource !== 'all') n++;
    if (filterStatus !== 'all') n++;
    if (filterIcp !== 'all') n++;
    if (scraperRunIdFilter) n++;
    return n;
  }, [filterCity, filterCategory, filterSource, filterStatus, filterIcp, scraperRunIdFilter]);

  const fetchLeads = useCallback(async () => {
    const myGen = ++fetchGenerationRef.current;
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: ((page - 1) * pageSize).toString(),
        sortBy: sortConfig.key,
        sortOrder: sortConfig.order,
      });

      if (debouncedSearch) params.append('q', debouncedSearch);
      if (filterCity !== 'all') params.append('city', filterCity);
      if (filterCategory !== 'all') params.append('category', filterCategory);
      if (filterSource !== 'all') params.append('source', filterSource);
      if (filterStatus !== 'all') params.append('status', filterStatus);
      
      if (filterIcp === 'high') { params.append('icpMin', '80'); }
      else if (filterIcp === 'medium') { params.append('icpMin', '40'); params.append('icpMax', '79'); }
      else if (filterIcp === 'low') { params.append('icpMax', '39'); }

      if (scraperRunIdFilter) params.set('scraperRunId', scraperRunIdFilter)

      if (needFiltersMetaRef.current) params.set('includeFiltersMeta', '1');

      const listPath = `/api/companies?${params.toString()}`
      const res = await authFetch(apiUrl(listPath))
      if (myGen !== fetchGenerationRef.current) return

      if (!res.ok) {
        const relative = apiUrl(listPath)
        const attempted =
          typeof window !== 'undefined' && !relative.startsWith('http')
            ? `${window.location.origin}${relative}`
            : relative
        const directOrigin = (import.meta.env.VITE_PUBLIC_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? ''

        let msg: string
        if (res.status === 404) {
          const backend = devApiBackendHint()
          msg = [
            `404 — /api/companies не найден. Чаще всего на порту API отвечает не тот процесс (прокси Vite → ${backend}).`,
            '',
            `Проверка: curl -sS "${backend}/health"`,
            `У Leadiya в JSON должно быть "service":"leadiya-api". Если видите "healthy" или plain text — это не этот API.`,
            '',
            `Запуск: \`npm run dev:api\` или \`npm run dev:web\`. Порт по умолчанию — в dev-ports.json (localCliApiPort).`,
            `Устаревший .env: уберите LEADIYA_API_ORIGIN=http://localhost:3001, если не используете 3001 для Hono.`,
            attempted ? `Запрос: ${attempted}` : '',
            directOrigin ? `VITE_PUBLIC_API_ORIGIN=${directOrigin}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        } else if (res.status === 401) {
          msg = [
            `HTTP 401 — API требует Bearer-токен (Supabase JWT).`,
            `Для локального Hono: AUTH_BYPASS=true в .env в корне репозитория и перезапуск API.`,
            `Запрос: ${attempted}`,
          ].join('\n')
        } else if (res.status === 502) {
          msg = [
            `HTTP 502 — прокси не достучался до API (неверный LEADIYA_API_ORIGIN или API не слушает).`,
            `Запрос: ${attempted}`,
            `Из корня: \`npm run dev:web:stable\` (дашборд + авто-рестарт API).`,
            `Или вручную: \`npm run dev:api\` + \`npm run dev:dashboard\`.`,
          ].join('\n')
        } else {
          msg = [
            `API вернул ${res.status}.`,
            `Запрос: ${attempted}`,
            `Dev: \`npm run dev:web\`. Продакшен: задайте VITE_PUBLIC_API_ORIGIN и маршруты /api на том же API.`,
          ].join('\n')
        }
        setFetchError(msg)
        setLeads([])
        setTotal(0)
        return
      }
      const data = (await res.json()) as {
        items?: Lead[]
        pagination?: { total?: number }
        filtersMeta?: FiltersMeta
      };

      if (myGen !== fetchGenerationRef.current) return;

      setLeads(data.items || []);
      setTotal(data.pagination?.total || 0);
      if (data.filtersMeta && typeof data.filtersMeta === 'object') {
        setFiltersMeta(data.filtersMeta);
        needFiltersMetaRef.current = false;
      }
    } catch (err) {
      if (myGen !== fetchGenerationRef.current) return;
      console.error('Failed to fetch leads:', err);
      const isNetwork =
        err instanceof TypeError &&
        (err.message === 'Failed to fetch' || err.message.includes('NetworkError'))
      setFetchError(
        isNetwork
          ? 'Сеть: дашборд не достучался до API. Из корня: `npm run dev:web:stable` (авто-рестарт API) или `npm run dev:api` + `npm run dev:dashboard`. Vite проксирует на LEADIYA_API_ORIGIN (по умолчанию http://localhost:3041).'
          : err instanceof Error
            ? err.message
            : 'Не удалось вызвать /api/companies',
      )
      setLeads([]);
      setTotal(0);
    } finally {
      if (myGen === fetchGenerationRef.current) {
        setLoading(false);
        setListHydrated(true);
      }
    }
  }, [page, pageSize, debouncedSearch, sortConfig, filterCity, filterCategory, filterSource, filterStatus, filterIcp, scraperRunIdFilter]);

  useEffect(() => {
    setPage(1)
  }, [scraperRunIdFilter])

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads, refreshNonce]);

  useEffect(() => {
    if (!scraperRunIdFilter || leads.length === 0) return
    const t = window.setTimeout(() => {
      document.querySelector('[data-scraper-run-first-row="1"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 100)
    return () => window.clearTimeout(t)
  }, [scraperRunIdFilter, leads])

  useEffect(() => {
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const toggleSelect = (e: ReactMouseEvent, id: string) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      order: current.key === key && current.order === 'asc' ? 'desc' : 'asc'
    }));
    setPage(1);
  };

  const paginatedLeads = leads;

  const postBulkAction = async (body: Record<string, unknown>) => {
    const res = await authFetch(apiUrl('/api/companies/bulk-action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    if (!res.ok) {
      throw new Error(data.error || `Запрос не выполнен (${res.status})`)
    }
    return data.message ?? 'Готово'
  }

  function formatLeadsClaimedRu(n: number): string {
    const mod100 = n % 100
    const mod10 = n % 10
    if (mod100 >= 11 && mod100 <= 14) return `${n} лидов добавлено в CRM`
    if (mod10 === 1) return `${n} лид добавлен в CRM`
    if (mod10 >= 2 && mod10 <= 4) return `${n} лида добавлено в CRM`
    return `${n} лидов добавлено в CRM`
  }

  const handleClaimToCrm = async () => {
    const leadIds = [...selectedIds]
    const total = leadIds.length
    if (total === 0) return
    setClaimingCrm(true)
    try {
      const res = await authFetch(apiUrl('/api/crm/leads/claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        claimed?: number
        alreadyClaimed?: number
        error?: string
      }
      if (!res.ok) {
        throw new Error(data.error || `Запрос не выполнен (${res.status})`)
      }
      const claimed = data.claimed ?? 0
      const alreadyClaimed = data.alreadyClaimed ?? 0
      if (alreadyClaimed === total) {
        toast('Все выбранные уже в CRM', 'info')
      } else if (claimed > 0) {
        const base = formatLeadsClaimedRu(claimed)
        toast(
          alreadyClaimed > 0 ? `${base} (${alreadyClaimed} уже в CRM)` : base,
          'success',
        )
      } else {
        toast('Не удалось добавить лиды в CRM', 'error')
      }
      setSelectedIds(new Set())
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось добавить в CRM', 'error')
    } finally {
      setClaimingCrm(false)
    }
  }

  const handleEnrich = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEnrichingId(id);
    try {
      const res = await authFetch(apiUrl(`/api/companies/${id}/enrich`), { method: 'POST' });
      if (!res.ok) throw new Error();
      toast('Обогащение поставлено в очередь', 'success');
      setTimeout(() => fetchLeads(), 2000);
    } catch {
      toast('Не удалось поставить обогащение в очередь', 'error');
    } finally {
      setEnrichingId(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-20">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading && !listHydrated ? 'Загрузка списка лидов с сервера.' : ''}
        {listHydrated && loading ? 'Обновление списка лидов.' : ''}
      </p>
      {fetchError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100"
        >
          <p className="font-bold text-rose-200">Не удалось загрузить лиды</p>
          <p className="mt-2 text-rose-100/90 whitespace-pre-wrap font-mono text-xs leading-relaxed">{fetchError}</p>
        </div>
      )}
      <div className="flex flex-col gap-6">
        {/* Search & Stats */}
        {extensionStatus === 'disconnected' && (
          <div className="rounded-lg border border-amber-500/15 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
            Расширение не подключено — меню «Расширение».
          </div>
        )}

        {scraperRunIdFilter && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-950/30 px-4 py-3 text-sm">
            <span className="text-slate-400">Лиды этого запуска 2GIS</span>
            <code className="text-xs font-mono text-amber-200/95">{scraperRunIdFilter.slice(0, 8)}…</code>
            {onClearScraperRunFilter ? (
              <button
                type="button"
                onClick={onClearScraperRunFilter}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300 underline underline-offset-2"
              >
                Сбросить фильтр
              </button>
            ) : null}
            <span className="text-[11px] text-slate-500">Новые сборы с версии кода пишут <code className="text-slate-400">twogisScraperRunId</code> в raw_data.</span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
          <div className="relative w-full lg:w-[min(100%,28rem)] group">
            <input 
              type="text" 
              placeholder="Название, БИН, телефон или почта…" 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full bg-slate-900/60 border border-white/[0.08] rounded-xl px-12 py-3.5 text-sm focus:border-sky-500/40 focus:ring-1 focus:ring-sky-500/20 transition-all outline-none"
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-400 transition-colors" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
             <div className="px-4 py-2.5 bg-slate-900/60 rounded-xl border border-white/[0.08] flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500">Всего по фильтру</span>
                  <span className="text-sm font-semibold text-slate-100 tabular-nums">
                    {loading && !listHydrated ? '—' : total.toLocaleString()}
                  </span>
                </div>
                <div className="w-px h-6 bg-white/5"></div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500">Выбрано</span>
                  <span className="text-sm font-semibold text-slate-300 tabular-nums">{selectedIds.size}</span>
                </div>
             </div>

              {listHydrated && loading && (
                <span className="text-xs text-sky-400/90 font-medium flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  Обновление списка…
                </span>
              )}

              <div className="flex flex-col gap-1 min-w-[200px]">
                <label htmlFor="lead-sort" className="text-[10px] text-slate-500">
                  Сортировка
                </label>
                <select
                  id="lead-sort"
                  value={`${sortConfig.key}:${sortConfig.order}`}
                  onChange={(e) => {
                    const [key, order] = e.target.value.split(':') as [SortKey, SortOrder]
                    setSortConfig({ key, order })
                    setPage(1)
                  }}
                  className="bg-slate-950/90 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
                >
                  <option value="createdAt:desc">Сначала недавно добавленные</option>
                  <option value="createdAt:asc">Сначала старые</option>
                  <option value="name:asc">Компания А → Я</option>
                  <option value="name:desc">Компания Я → А</option>
                  <option value="icpScore:desc">Сначала выше ICP</option>
                  <option value="icpScore:asc">Сначала ниже ICP</option>
                  <option value="city:asc">Город А → Я</option>
                  <option value="city:desc">Город Я → А</option>
                  <option value="status:asc">Статус А → Я</option>
                  <option value="status:desc">Статус Я → А</option>
                  <option value="bin:asc">БИН по возрастанию</option>
                  <option value="bin:desc">БИН по убыванию</option>
                </select>
              </div>

             <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              title="Показать или скрыть фильтры по городу, категории, ICP и статусу"
              className={`px-3 py-3 rounded-xl border text-xs font-medium transition-colors ${
                filtersOpen || activeFilterCount > 0 || scraperRunIdFilter
                  ? 'bg-slate-800 border-sky-500/35 text-sky-200'
                  : 'bg-slate-900 border-white/[0.08] text-slate-400 hover:text-slate-200'
              }`}
             >
               Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
             </button>

             <button 
              type="button"
              onClick={() => {
                needFiltersMetaRef.current = true;
                void fetchLeads();
              }}
              title="Обновить страницу и счётчики фильтров с API"
              className="p-3 bg-slate-900 border border-white/[0.08] rounded-xl hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
             >
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
             </button>
          </div>
        </div>

        {/* Bulk Action Toolbar - STICKY */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-8 py-4 rounded-2xl bg-gradient-to-r from-sky-600 to-cyan-600 shadow-xl shadow-sky-900/40 animate-slide-up">
            <div className="flex items-center gap-4">
              <span className="text-xs font-black text-white uppercase tracking-widest">Выбрано лидов: {selectedIds.size}</span>
              <div className="w-px h-6 bg-white/20"></div>
              <button className="text-[10px] font-bold text-white/80 hover:text-white transition-colors uppercase tracking-widest" onClick={() => setSelectedIds(new Set())}>Снять выделение</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={claimingCrm}
                className="px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-[#020617] shadow-lg shadow-sky-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                onClick={() => void handleClaimToCrm()}
              >
                {claimingCrm ? 'Добавление…' : 'В мою CRM'}
              </button>
              <button
                className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                onClick={async () => {
                  const n = selectedIds.size
                  try {
                    await postBulkAction({ ids: [...selectedIds], action: 'enrich' })
                    toast(`В очередь на обогащение: ${n} лидов`, 'success')
                    setSelectedIds(new Set())
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Не удалось поставить обогащение в очередь', 'error')
                  }
                }}
              >Обогатить выбранные</button>
              <button
                className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                onClick={async () => {
                  const n = selectedIds.size
                  try {
                    await postBulkAction({ ids: [...selectedIds], action: 'archive' })
                    toast(`В архив: ${n} лидов`, 'success')
                    setSelectedIds(new Set())
                    needFiltersMetaRef.current = true
                    await fetchLeads()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Не удалось отправить в архив', 'error')
                  }
                }}
              >В архив</button>
              <button
                className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                title="Вернуть статус (например, из архива)"
                onClick={async () => {
                  const n = selectedIds.size
                  try {
                    await postBulkAction({ ids: [...selectedIds], action: 'restore' })
                    toast(`Восстановлено лидов: ${n}`, 'success')
                    setSelectedIds(new Set())
                    needFiltersMetaRef.current = true
                    await fetchLeads()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Не удалось восстановить', 'error')
                  }
                }}
              >Восстановить</button>
              <button
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                onClick={async () => {
                  const n = selectedIds.size
                  if (
                    !window.confirm(
                      `Удалить ${n} лид(ов) безвозвратно? Связанные контакты и строки журнала рассылки удалятся, насколько позволяет БД. Отменить нельзя.`,
                    )
                  ) {
                    return
                  }
                  try {
                    await postBulkAction({ ids: [...selectedIds], action: 'delete' })
                    toast(`Удалено лидов: ${n}`, 'success')
                    setSelectedIds(new Set())
                    needFiltersMetaRef.current = true
                    await fetchLeads()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Не удалось удалить', 'error')
                  }
                }}
              >Удалить</button>
              <button
                className="px-5 py-2 bg-white text-sky-900 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                onClick={async () => {
                  const params = new URLSearchParams()
                  if (searchInput.trim()) params.append('q', searchInput.trim())
                  if (filterCity !== 'all') params.append('city', filterCity)
                  if (filterCategory !== 'all') params.append('category', filterCategory)
                  if (filterSource !== 'all') params.append('source', filterSource)
                  if (filterStatus !== 'all') params.append('status', filterStatus)
                  if (filterIcp === 'high') { params.append('icpMin', '80'); }
                  else if (filterIcp === 'medium') { params.append('icpMin', '40'); params.append('icpMax', '79'); }
                  else if (filterIcp === 'low') { params.append('icpMax', '39'); }
                  const url = apiUrl(`/api/companies/export?${params.toString()}`)
                  const res = await authFetch(url)
                  if (!res.ok) { toast('Ошибка экспорта', 'error'); return }
                  const blob = await res.blob()
                  const blobUrl = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = blobUrl
                  a.download = 'leads.csv'
                  a.click()
                  URL.revokeObjectURL(blobUrl)
                }}
              >Экспорт CSV</button>
            </div>
          </div>
        )}

        {filtersOpen && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 p-5 crm-panel rounded-2xl border border-white/[0.08]">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Город</label>
            <select 
              value={filterCity}
              onChange={(e) => {
                setFilterCity(e.target.value)
                setPage(1)
              }}
              className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
            >
              <option value="all">Все города</option>
              {(filtersMeta?.cities ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Категория</label>
            <select 
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value)
                setPage(1)
              }}
              className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
            >
              <option value="all">Все категории</option>
              {(filtersMeta?.uncategorizedCount ?? 0) > 0 && (
                <option value="__empty__">Без категории ({filtersMeta?.uncategorizedCount})</option>
              )}
              {(filtersMeta?.categories ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value.length > 42 ? `${c.value.slice(0, 40)}…` : c.value} ({c.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Источник</label>
            <select 
              value={filterSource}
              onChange={(e) => {
                setFilterSource(e.target.value)
                setPage(1)
              }}
              className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
            >
              <option value="all">Все источники</option>
              {sourceOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} {s.count > 0 ? `(${s.count})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-slate-500"
              title="ICP — насколько лид подходит вашему сегменту (0–100)."
            >
              Балл ICP
            </label>
            <select 
              value={filterIcp}
              onChange={(e) => {
                setFilterIcp(e.target.value)
                setPage(1)
              }}
              className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
              title="Фильтр по ICP: высокий / средний / низкий"
            >
              <option value="all">Любой балл</option>
              <option value="high">Высокий (80+)</option>
              <option value="medium">Средний (40–79)</option>
              <option value="low">Ниже (&lt;40)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Статус</label>
            <select 
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setPage(1)
              }}
              className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/40 cursor-pointer"
            >
              <option value="all">Все статусы</option>
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {leadStatusLabel(s.value)} {s.count > 0 ? `(${s.count})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        )}
      </div>

      {/* Lead table — детали 2GIS, сайт, ICP — в боковой панели */}
      <div
        className={`crm-panel rounded-2xl overflow-hidden border border-white/[0.08] transition-opacity ${listHydrated && loading ? 'opacity-90' : ''}`}
      >
        <div className="overflow-x-auto">
          <table
            className="w-full text-left border-collapse min-w-[720px]"
            aria-busy={loading}
            aria-label="Лиды"
          >
            <thead className="bg-slate-950/60 border-b border-white/5 text-slate-500">
              <tr>
                <th className={`px-5 py-5 w-10`}>
                  <div 
                    onClick={(e) => { e.stopPropagation(); toggleSelectAll(); }}
                    className={`w-5 h-5 rounded-md border-2 transition-all cursor-pointer flex items-center justify-center ${selectedIds.size === leads.length && leads.length > 0 ? 'bg-brand-500 border-brand-500' : 'border-white/10 hover:border-white/20'}`}
                  >
                    {selectedIds.size === leads.length && leads.length > 0 && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    )}
                  </div>
                </th>
                <th className={`px-5 py-5 text-left align-bottom`}>
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="text-left cursor-pointer group w-full"
                  >
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300 group-hover:text-white">
                      Компания
                      {sortConfig.key === 'name' && (
                        <span className={sortConfig.order === 'asc' ? ' text-brand-400' : ' text-indigo-400'}>
                          {sortConfig.order === 'asc' ? ' ↑' : ' ↓'}
                        </span>
                      )}
                    </span>
                  </button>
                </th>
                <th 
                  className={`px-5 py-5 text-left align-bottom cursor-pointer hover:text-white`}
                  onClick={() => handleSort('city')}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    Город
                    {sortConfig.key === 'city' && <span className="text-brand-400">{sortConfig.order === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </span>
                </th>
                <th className={`px-5 py-5 text-left align-bottom`}>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300">Контакт</span>
                </th>
                <th
                  className={`px-5 py-5 text-left align-bottom cursor-pointer hover:text-white whitespace-nowrap`}
                  onClick={() => handleSort('createdAt')}
                  title="Когда лид впервые сохранён в БД"
                >
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    Добавлено
                    {sortConfig.key === 'createdAt' && <span className="text-brand-400">{sortConfig.order === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </span>
                </th>
                <th className={`px-5 py-5 text-right align-bottom text-[10px] font-bold uppercase tracking-widest text-slate-300`}>Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && !listHydrated ? (
                <LeadTableSkeletonRows rows={8} />
              ) : paginatedLeads.length === 0 && fetchError ? null : paginatedLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-16 text-center">
                    <p className="text-sm font-black uppercase tracking-widest text-slate-500">
                      В таблице лидов пока пусто
                    </p>
                    <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-slate-400">
                      Проверьте Postgres и <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-brand-300">npm run db:setup</code>
                      , либо запустите сбор 2GIS.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead, idx) => (
                <tr 
                  key={lead?.id} 
                  data-scraper-run-first-row={scraperRunIdFilter && idx === 0 ? '1' : undefined}
                  onClick={() => onLeadClick?.(lead)}
                  className="hover:bg-brand-500/[0.04] transition-all cursor-pointer group/row"
                >
                  <td className={`px-5 py-6`}>
                    <div 
                      onClick={(e) => toggleSelect(e, lead.id)}
                      className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${selectedIds.has(lead.id) ? 'bg-brand-500 border-brand-500' : 'border-white/10 group-hover/row:border-white/30'}`}
                    >
                      {selectedIds.has(lead.id) && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      )}
                    </div>
                  </td>

                  <td className={`px-5 py-6`}>
                    <div className="flex items-center gap-3 min-w-0 max-w-[min(100%,22rem)]">
                      <div className={`shrink-0 w-11 h-11 text-sm rounded-xl bg-slate-900 border border-white/5 flex items-center justify-center font-bold text-slate-500 group-hover/row:bg-brand-500/10 group-hover/row:text-brand-400 transition-colors`}>
                        {lead?.name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0 space-y-1 select-text">
                        <h4 className="text-[13px] font-semibold text-slate-100 truncate" title={lead?.name || ''}>
                          {lead?.name || '—'}
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-slate-500">
                          <span className="font-mono text-slate-400">{lead?.bin || '—'}</span>
                          <span className="text-slate-600">·</span>
                          <SourceBadge source={lead?.source} />
                          <StatusBadge status={lead?.status} />
                        </div>
                        {(lead.category || lead.twogisCardCategory || lead.rating2gis?.trim()) && (
                          <>
                            <p
                              className="text-[10px] text-slate-500 truncate"
                              title={[lead.category, lead.rating2gis?.trim() ? `★ ${lead.rating2gis}` : ''].filter(Boolean).join(' · ')}
                            >
                              {lead.category
                                ? lead.category.length > 40
                                  ? `${lead.category.slice(0, 38)}…`
                                  : lead.category
                                : ''}
                              {lead.category && lead.rating2gis?.trim() ? ' · ' : ''}
                              {lead.rating2gis?.trim() ? `★ ${lead.rating2gis}` : ''}
                            </p>
                            {lead.twogisCardCategory?.trim() ? (
                              <p
                                className="text-[10px] text-slate-500/85 truncate"
                                title={lead.twogisCardCategory}
                              >
                                2GIS:{' '}
                                {lead.twogisCardCategory.length > 48
                                  ? `${lead.twogisCardCategory.slice(0, 46)}…`
                                  : lead.twogisCardCategory}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </td>

                  <td
                    className={`px-5 py-6 select-text max-w-[10rem]`}
                    title={
                      lead?.address?.trim()
                        ? `${lead?.city || ''}${lead?.city ? ' — ' : ''}${lead.address}`
                        : (lead?.city || '')
                    }
                  >
                    <span className="text-xs font-medium text-slate-200 line-clamp-2">
                      {lead?.city || '—'}
                    </span>
                  </td>

                  <td className={`px-5 py-6 max-w-[14rem]`}>
                    <LeadReachSummary lead={lead} />
                  </td>

                  <td
                    className={`px-5 py-6 text-[11px] text-slate-400 font-medium tabular-nums whitespace-nowrap`}
                    title={lead.createdAt ? new Date(lead.createdAt).toISOString() : undefined}
                  >
                    {formatAddedAt(lead.createdAt)}
                  </td>

                  <td className={`px-5 py-6 text-right`}>
                    <div className="flex justify-end gap-3 opacity-0 group-hover/row:opacity-100 transition-all translate-x-4 group-hover/row:translate-x-0">
                      <button 
                        onClick={(e) => handleEnrich(e, lead?.id)}
                        disabled={enrichingId === lead?.id}
                        className={`w-11 h-11 rounded-2xl bg-slate-900 border border-white/5 text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 hover:border-brand-500/30 transition-all active:scale-95 flex items-center justify-center shadow-2xl`}
                        title="Поставить обогащение в очередь"
                      >
                         <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Advanced Pagination Console */}
        <div className="p-8 bg-slate-950/60 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="flex items-center gap-4">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                {loading && !listHydrated ? (
                  <span className="text-slate-600">Загрузка диапазона…</span>
                ) : (
                  <>
                    Показано{' '}
                    <span className="text-brand-400">
                      {(page - 1) * pageSize + 1} — {Math.min(page * pageSize, total)}
                    </span>{' '}
                    из <span className="text-white">{total.toLocaleString()}</span>
                  </>
                )}
              </div>
           </div>
           
           <div className="flex items-center gap-2">
             <button 
               onClick={(e) => { e.stopPropagation(); setPage(1); }}
               disabled={page === 1}
               className="p-3 rounded-xl bg-slate-900 border border-white/5 text-slate-500 hover:text-white disabled:opacity-20 transition-all font-black text-[10px]"
             >
               НАЧАЛО
             </button>
             <button 
               onClick={(e) => { e.stopPropagation(); setPage(p => Math.max(1, p - 1)); }}
               disabled={page === 1}
               className="p-3 rounded-xl bg-slate-900 border border-white/5 text-slate-500 hover:text-white disabled:opacity-20 transition-all"
             >
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
             </button>
             
             <div className="flex items-center gap-1 px-4">
                <span className="text-xs font-black text-brand-400">{page}</span>
                <span className="text-[10px] font-black text-slate-700">/</span>
                <span className="text-[10px] font-black text-slate-500">{totalPages || 1}</span>
             </div>

             <button 
               onClick={(e) => { e.stopPropagation(); setPage(p => Math.min(totalPages, p + 1)); }}
               disabled={page === totalPages || totalPages === 0}
               className="p-3 rounded-xl bg-slate-900 border border-white/5 text-slate-500 hover:text-white disabled:opacity-20 transition-all"
             >
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
             </button>
             <button 
               onClick={(e) => { e.stopPropagation(); setPage(totalPages); }}
               disabled={page === totalPages || totalPages === 0}
               className="p-3 rounded-xl bg-slate-900 border border-white/5 text-slate-500 hover:text-white disabled:opacity-20 transition-all font-black text-[10px]"
             >
               КОНЕЦ
             </button>
           </div>

           {leads.length === 0 && !loading && (
             <button 
                onClick={() => {
                  setSearchInput('');
                  setFilterCategory('all');
                  setFilterStatus('all');
                  setFilterCity('all');
                  setFilterSource('all');
                  setFilterIcp('all');
                  setPage(1);
                }}
                className="text-xs font-black text-brand-500 uppercase tracking-widest hover:underline underline-offset-8 decoration-2"
              >
                Сбросить фильтры
              </button>
           )}
        </div>
      </div>
    </div>
  );
}
