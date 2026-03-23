import { useCallback, useEffect, useState } from 'react';
import type { Lead, Contact } from '../types';
import { useToast } from '../hooks/useToast'

interface LeadsTableProps {
  onLeadClick?: (lead: Lead) => void;
}

type SortKey = 'name' | 'city' | 'bin' | 'status' | 'createdAt' | 'icpScore';
type SortOrder = 'asc' | 'desc';

/** Matches `leads.city` from 2GIS scrapers (Cyrillic). API also accepts Latin aliases. */
const FILTER_CITIES = [
  'Алматы',
  'Астана',
  'Шымкент',
  'Актобе',
  'Караганда',
  'Тараз',
  'Усть-Каменогорск',
  'Костанай',
  'Павлодар',
] as const

/** Common 2GIS search categories + legacy English verticals. */
const FILTER_CATEGORIES = [
  'Университеты',
  'Институты',
  'Академии',
  'Колледжи',
  'Высшие учебные заведения',
  'Негосударственные вузы',
  'Бизнес-школы',
  'Филиалы университетов',
  'Bars',
  'Beauty Salons',
  'Car Services',
] as const

const SourceBadge = ({ source }: { source: string | null }) => {
  const normalized = (source || '').toLowerCase();
  let styles = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  if (normalized === '2gis') styles = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (normalized === 'manual') styles = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  
  return (
    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-widest ${styles}`}>
      {source || 'Unknown'}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string | null }) => {
  const normalized = (status || 'new').toLowerCase();
  let styles = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  if (normalized === 'valid' || normalized === 'enriched') styles = 'bg-brand-500/10 text-brand-400 border-brand-500/20';
  if (normalized === 'failed') styles = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  
  return (
    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-widest ${styles}`}>
      {normalized}
    </span>
  );
};

const ContactPill = ({ contact }: { contact: Contact }) => {
  const isEmail = !!contact.email;
  const val = contact.phone || contact.email;
  if (!val) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-white/5 rounded-lg group/pill hover:border-brand-500/30 transition-all">
      <div className={`w-1.5 h-1.5 rounded-full ${isEmail ? 'bg-indigo-400' : 'bg-emerald-400'}`}></div>
      <span className="text-[10px] font-mono font-bold text-slate-300 group-hover/pill:text-white transition-colors">
        {val}
      </span>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(val);
        }}
        className="opacity-0 group-hover/pill:opacity-100 transition-opacity hover:text-brand-400 p-0.5"
        title="Copy"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>
    </div>
  );
};


export function LeadsTable({ onLeadClick }: LeadsTableProps) {
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  
  const [search, setSearch] = useState('');
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; order: SortOrder }>({ key: 'createdAt', order: 'desc' });
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCity, setFilterCity] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterIcp, setFilterIcp] = useState<string>('all');

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: ((page - 1) * pageSize).toString(),
        sortBy: sortConfig.key,
        sortOrder: sortConfig.order,
      });

      if (search) params.append('q', search);
      if (filterCity !== 'all') params.append('city', filterCity);
      if (filterCategory !== 'all') params.append('category', filterCategory);
      if (filterSource !== 'all') params.append('source', filterSource);
      if (filterStatus !== 'all') params.append('status', filterStatus);
      
      if (filterIcp === 'high') { params.append('icpMin', '80'); }
      else if (filterIcp === 'medium') { params.append('icpMin', '40'); params.append('icpMax', '79'); }
      else if (filterIcp === 'low') { params.append('icpMax', '39'); }

      const res = await fetch(`/api/companies?${params.toString()}`);
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      
      setLeads(data.items || []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, sortConfig, filterCity, filterCategory, filterSource, filterStatus, filterIcp]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
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

  const handleEnrich = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEnrichingId(id);
    try {
      const res = await fetch(`/api/companies/${id}/enrich`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast('Enrichment queued', 'success');
      setTimeout(() => fetchLeads(), 2000);
    } catch {
      toast('Failed to queue enrichment', 'error');
    } finally {
      setEnrichingId(null);
    }
  };

  if (loading && leads.length === 0) return (
    <div className="p-20 flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Syncing Intelligence Matrix...</p>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-20">
      <div className="flex flex-col gap-6">
        {/* Search & Stats */}
        <div className="flex flex-col lg:flex-row gap-4 justify-between items-center">
          <div className="relative w-full lg:w-[32rem] group">
            <input 
              type="text" 
              placeholder="Search by name, BIN, phone or email..." 
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="w-full bg-slate-950/40 border border-white/5 rounded-2xl px-12 py-4 text-xs font-medium focus:border-brand-500/50 transition-all outline-none backdrop-blur-xl group-hover:border-white/10"
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-400 transition-colors" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="px-5 py-2.5 bg-brand-500/5 rounded-2xl border border-brand-500/10 flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em]">Live Registry</span>
                  <span className="text-xs font-black text-brand-400">{total.toLocaleString()}</span>
                </div>
                <div className="w-px h-6 bg-white/5"></div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em]">Selection</span>
                  <span className="text-xs font-black text-slate-400">{selectedIds.size}</span>
                </div>
             </div>

              {/* Density Toggle */}
              <div className="flex bg-slate-900/50 border border-white/5 p-1 rounded-2xl">
                 <button 
                  onClick={() => setDensity('comfortable')}
                  className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${density === 'comfortable' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   Comfortable
                 </button>
                 <button 
                  onClick={() => setDensity('compact')}
                  className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${density === 'compact' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   Compact
                 </button>
              </div>

             <button 
              onClick={() => fetchLeads()}
              className="p-3.5 bg-slate-900 border border-white/5 rounded-2xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
             >
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
             </button>
          </div>
        </div>

        {/* Bulk Action Toolbar - STICKY */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-8 py-4 bg-brand-500 rounded-2xl shadow-2xl shadow-brand-500/40 animate-slide-up">
            <div className="flex items-center gap-4">
              <span className="text-xs font-black text-white uppercase tracking-widest">{selectedIds.size} Leads Selected</span>
              <div className="w-px h-6 bg-white/20"></div>
              <button className="text-[10px] font-bold text-white/80 hover:text-white transition-colors uppercase tracking-widest" onClick={() => setSelectedIds(new Set())}>Deselect All</button>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/companies/bulk-action', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ids: [...selectedIds], action: 'enrich' }),
                    })
                    if (!res.ok) throw new Error()
                    toast(`Enrichment queued for ${selectedIds.size} leads`, 'success')
                    setSelectedIds(new Set())
                  } catch {
                    toast('Failed to queue enrichment', 'error')
                  }
                }}
              >Enrich Selection</button>
              <button
                className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/companies/bulk-action', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ids: [...selectedIds], action: 'archive' }),
                    })
                    if (!res.ok) throw new Error()
                    toast(`Archived ${selectedIds.size} leads`, 'success')
                    setSelectedIds(new Set())
                    fetchLeads()
                  } catch {
                    toast('Failed to archive', 'error')
                  }
                }}
              >Archive</button>
              <button
                className="px-5 py-2 bg-white text-brand-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                onClick={() => {
                  const params = new URLSearchParams()
                  if (search) params.append('q', search)
                  if (filterCity !== 'all') params.append('city', filterCity)
                  if (filterCategory !== 'all') params.append('category', filterCategory)
                  const url = `/api/companies/export?${params.toString()}`
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'leads.csv'
                  a.click()
                  toast('CSV download started', 'success')
                }}
              >Export CSV</button>
            </div>
          </div>
        )}

        {/* Global Multi-Filter Console */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-6 bg-slate-950/40 rounded-[2.5rem] border border-white/5 backdrop-blur-2xl">
          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-black text-slate-550 uppercase tracking-[0.2em] ml-1">Jurisdiction</label>
            <select 
              value={filterCity}
              onChange={(e) => {
                setFilterCity(e.target.value)
                setPage(1)
              }}
              className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3 text-[11px] font-black text-slate-300 outline-none focus:border-brand-500/50 appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <option value="all">ALL CITIES</option>
              {FILTER_CITIES.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-black text-slate-550 uppercase tracking-[0.2em] ml-1">Market Vertical</label>
            <select 
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value)
                setPage(1)
              }}
              className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3 text-[11px] font-black text-slate-300 outline-none focus:border-brand-500/50 appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <option value="all">ALL SECTORS</option>
              {FILTER_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-black text-slate-550 uppercase tracking-[0.2em] ml-1">Data Origin</label>
            <select 
              value={filterSource}
              onChange={(e) => {
                setFilterSource(e.target.value)
                setPage(1)
              }}
              className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3 text-[11px] font-black text-slate-300 outline-none focus:border-brand-500/50 appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <option value="all">ALL SOURCES</option>
              {['2gis', 'manual', 'enrichment', 're-scrape'].map(src => <option key={src} value={src}>{src.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-black text-slate-550 uppercase tracking-[0.2em] ml-1">ICP Scoring</label>
            <select 
              value={filterIcp}
              onChange={(e) => {
                setFilterIcp(e.target.value)
                setPage(1)
              }}
              className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3 text-[11px] font-black text-slate-300 outline-none focus:border-brand-500/50 appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <option value="all">ANY SCORE</option>
              <option value="high">HIGH FIT (80+)</option>
              <option value="medium">MEDIUM (40-79)</option>
              <option value="low">LOW FIT (&lt;40)</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-black text-slate-550 uppercase tracking-[0.2em] ml-1">Intelligence</label>
            <select 
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setPage(1)
              }}
              className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3 text-[11px] font-black text-slate-300 outline-none focus:border-brand-500/50 appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <option value="all">ALL STATES</option>
              {['new', 'valid', 'enriched', 'failed'].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* High-Density Table */}
      <div className="glass-card rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="bg-slate-950/60 border-b border-white/5 text-slate-500">
              <tr>
                <th className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} w-10`}>
                  <div 
                    onClick={(e) => { e.stopPropagation(); toggleSelectAll(); }}
                    className={`w-5 h-5 rounded-md border-2 transition-all cursor-pointer flex items-center justify-center ${selectedIds.size === leads.length && leads.length > 0 ? 'bg-brand-500 border-brand-500' : 'border-white/10 hover:border-white/20'}`}
                  >
                    {selectedIds.size === leads.length && leads.length > 0 && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    )}
                  </div>
                </th>
                <th 
                  className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] cursor-pointer hover:text-white transition-colors"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-2">
                    IDENTIFICATION
                    {sortConfig.key === 'name' && (
                       <span className={sortConfig.order === 'asc' ? 'text-brand-400' : 'text-indigo-400'}>
                         {sortConfig.order === 'asc' ? '↑' : '↓'}
                       </span>
                    )}
                  </div>
                </th>
                <th 
                  className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} text-[10px] font-black uppercase tracking-[0.2em] cursor-pointer hover:text-white transition-colors`}
                  onClick={() => handleSort('city')}
                >
                  JURISDICTION
                  {sortConfig.key === 'city' && <span className="ml-2 text-brand-400">{sortConfig.order === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} text-[10px] font-black uppercase tracking-[0.2em]`}>CONTACT PULSE (ALL SIGNALS)</th>
                <th className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} text-[10px] font-black uppercase tracking-[0.2em]`}>CLASSIFICATION</th>
                <th 
                  className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} text-[10px] font-black uppercase tracking-[0.2em] cursor-pointer hover:text-white transition-colors text-center`}
                  onClick={() => handleSort('icpScore')}
                >
                  ICP
                  {sortConfig.key === 'icpScore' && <span className="ml-2 text-brand-400">{sortConfig.order === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className={`px-8 ${density === 'compact' ? 'py-3' : 'py-6'} text-[10px] font-black uppercase tracking-[0.2em] text-right`}>OPERATIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {paginatedLeads.map((lead) => (
                <tr 
                  key={lead?.id} 
                  onClick={() => onLeadClick?.(lead)}
                  className="hover:bg-brand-500/[0.04] transition-all cursor-pointer group/row"
                >
                  {/* Selection Checkbox */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'}`}>
                    <div 
                      onClick={(e) => toggleSelect(e, lead.id)}
                      className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${selectedIds.has(lead.id) ? 'bg-brand-500 border-brand-500' : 'border-white/10 group-hover/row:border-white/30'}`}
                    >
                      {selectedIds.has(lead.id) && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      )}
                    </div>
                  </td>

                  {/* Entity Information */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'}`}>
                    <div className="flex items-center gap-5">
                      <div className={`${density === 'compact' ? 'w-10 h-10 text-sm rounded-xl' : 'w-14 h-14 text-lg rounded-2xl'} bg-slate-900 border border-white/5 flex items-center justify-center font-black text-slate-500 group-hover/row:bg-brand-500/10 group-hover/row:text-brand-400 group-hover/row:border-brand-500/20 transition-all shadow-inner`}>
                        {lead?.name?.charAt(0) || '?'}
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-[13px] font-black text-slate-100 group-hover/row:text-white transition-colors">{lead?.name || 'UNKNOWN_ENTITY'}</h4>
                        <div className="flex items-center gap-3">
                           <span className="text-[10px] font-bold text-slate-550 font-mono">{lead?.bin || 'GCR_NULL'}</span>
                           <SourceBadge source={lead?.source} />
                           <StatusBadge status={lead?.status} />
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Jurisdiction */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'}`}>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-black text-slate-200 group-hover/row:text-brand-400 transition-colors">{lead?.city?.toUpperCase() || 'GLOBAL'}</span>
                      <span className="text-[9px] text-slate-500 max-w-[180px] break-words font-bold uppercase tracking-tighter" title={lead?.address || ''}>
                        {lead?.address || 'Geolocation unknown'}
                      </span>
                    </div>
                  </td>

                  {/* All Contact Signals - DENSE GRID */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'}`}>
                    <div className="flex flex-wrap gap-2 max-w-[350px]">
                       {lead.contacts && lead.contacts.length > 0 ? (
                         lead.contacts.map((c, i) => <ContactPill key={i} contact={c} />)
                       ) : (
                         <div className="text-[9px] font-black text-slate-700 uppercase italic tracking-widest bg-slate-900/50 px-3 py-1.5 rounded-lg border border-white/5">
                           Intelligence enrichment required
                         </div>
                       )}
                    </div>
                  </td>

                  {/* Vertical Classification */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'}`}>
                    {lead.category ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="px-3 py-1 rounded-xl bg-indigo-500/10 border border-indigo-400/20 text-[9px] font-black text-indigo-300 uppercase tracking-[0.15em] text-center shadow-lg">
                          {lead.category}
                        </span>
                        <div className="flex justify-center gap-1 opacity-40">
                           <div className="w-1 h-1 rounded-full bg-indigo-500"></div>
                           <div className="w-1 h-1 rounded-full bg-indigo-500"></div>
                           <div className="w-1 h-1 rounded-full bg-indigo-500"></div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[9px] font-black text-slate-700 uppercase tracking-widest opacity-20 italic">Node Unclassified</span>
                    )}
                  </td>

                  {/* ICP Score */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'} text-center`}>
                    <div className="inline-flex flex-col items-center">
                       <span className={`text-xl font-black ${(lead.icpScore || 0) >= 80 ? 'text-brand-400 mt-glow' : (lead.icpScore || 0) >= 40 ? 'text-indigo-400' : 'text-slate-500'}`}>
                         {lead.icpScore || 0}
                       </span>
                       <span className="text-[8px] font-black text-slate-600 uppercase tracking-tighter">FIT_INDEX</span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className={`px-8 ${density === 'compact' ? 'py-2' : 'py-6'} text-right`}>
                    <div className="flex justify-end gap-3 opacity-0 group-hover/row:opacity-100 transition-all translate-x-4 group-hover/row:translate-x-0">
                      <button 
                        onClick={(e) => handleEnrich(e, lead?.id)}
                        disabled={enrichingId === lead?.id}
                        className={`${density === 'compact' ? 'w-8 h-8' : 'w-11 h-11'} rounded-2xl bg-slate-900 border border-white/5 text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 hover:border-brand-500/30 transition-all active:scale-95 flex items-center justify-center shadow-2xl`}
                        title="Deep Neural Pulse"
                      >
                         <svg xmlns="http://www.w3.org/2000/svg" width={density === 'compact' ? "14" : "20"} height={density === 'compact' ? "14" : "20"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Advanced Pagination Console */}
        <div className="p-8 bg-slate-950/60 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="flex items-center gap-4">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                 Showing <span className="text-brand-400">{(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)}</span> of <span className="text-white">{total.toLocaleString()}</span> entities
              </div>
           </div>
           
           <div className="flex items-center gap-2">
             <button 
               onClick={(e) => { e.stopPropagation(); setPage(1); }}
               disabled={page === 1}
               className="p-3 rounded-xl bg-slate-900 border border-white/5 text-slate-500 hover:text-white disabled:opacity-20 transition-all font-black text-[10px]"
             >
               FIRST
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
               LAST
             </button>
           </div>

           {leads.length === 0 && !loading && (
             <button 
                onClick={() => {setSearch(''); setFilterCategory('all'); setFilterStatus('all'); setFilterCity('all'); setFilterSource('all'); setFilterIcp('all'); setPage(1);}}
                className="text-xs font-black text-brand-500 uppercase tracking-widest hover:underline underline-offset-8 decoration-2"
              >
                Flush Operational Filters
              </button>
           )}
        </div>
      </div>
    </div>
  );
}
