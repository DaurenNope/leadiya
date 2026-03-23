import { useEffect, useState } from 'react'

export function ExtensionHub() {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')

  useEffect(() => {
    // Check connection to the local Captcha Helper WebSocket
    const checkConnection = () => {
      const ws = new WebSocket('ws://localhost:8765')
      ws.onopen = () => {
        setStatus('connected')
        ws.close()
      }
      ws.onerror = () => {
        setStatus('disconnected')
      }
    }

    checkConnection()
    const interval = setInterval(checkConnection, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight premium-gradient-text uppercase">Extension Hub</h2>
          <p className="text-slate-500 text-sm mt-1 font-medium italic">Leadiya Captcha Helper & Site Automation</p>
        </div>
        <div className={`px-4 py-2 rounded-2xl border text-[10px] font-black tracking-widest flex items-center gap-2 ${
          status === 'connected' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}></div>
          {status === 'connected' ? 'SERVICE_ACTIVE' : 'SERVICE_OFFLINE'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Connection Tool */}
        <div className="glass-card p-8 rounded-3xl overflow-hidden relative group">
          <div className="absolute -right-4 -top-4 w-32 h-32 bg-brand-500/5 blur-3xl rounded-full group-hover:bg-brand-500/10 transition-all"></div>
          
          <h3 className="text-lg font-bold flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400"><path d="M12 2v8"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h8"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 22v-8"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-8"/><path d="m19.07 4.93-2.83 2.83"/></svg>
            Installation Guide
          </h3>
          <p className="text-slate-400 text-sm mt-4 leading-relaxed">
            The Leadiya Extension allows the autonomous scraper to bypass complex bot protections and captchas by using your local browser session.
          </p>
          
          <div className="mt-8 space-y-4">
            {[
              "Download the extension bundle (.zip)",
              "Navigate to chrome://extensions",
              "Enable 'Developer Mode'",
              "Click 'Load Unpacked' and select the folder"
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-4 text-xs font-bold text-slate-300">
                <span className="w-6 h-6 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-brand-400">{i + 1}</span>
                {step}
              </div>
            ))}
          </div>

          <button className="mt-8 w-full bg-white text-black py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-brand-500 hover:text-white transition-all shadow-xl active:scale-[0.98]">
            Download Extension v2.4
          </button>
        </div>

        {/* Live Captcha Console */}
        <div className="glass-card p-8 rounded-3xl border-brand-500/20 shadow-brand-500/5">
          <h3 className="text-lg font-bold flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Live Captcha Console
          </h3>
          
          <div className="mt-8 h-48 bg-slate-950/80 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center p-6 relative overflow-hidden">
             {status === 'connected' ? (
               <div className="space-y-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
                     <svg className="text-emerald-400 animate-pulse" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Idle / No Puzzles Detected</p>
                  <p className="text-[9px] font-medium text-slate-600 italic">Listening for bypass signals...</p>
               </div>
             ) : (
               <div className="space-y-4 scale-95 opacity-50">
                  <svg className="mx-auto text-rose-500/40" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Service Disconnected</p>
               </div>
             )}
          </div>

          <div className="mt-8 pt-8 border-t border-white/5 space-y-4">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span>Signal Strength</span>
                <span className="text-emerald-500">98% Nominal</span>
            </div>
            <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div className="w-[98%] h-full bg-emerald-500 shadow-pulse"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
