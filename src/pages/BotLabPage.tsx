import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { INDICATOR_LIBRARY, CANDLE_PATTERNS, type IndicatorMeta } from '../components/indicators';

interface CustomBot {
  id: string; user_id: string; name: string; description: string;
  status: 'lab'|'active'|'paused'|'archived'; is_public: boolean;
  indicators: {id:string;params:Record<string,number>}[];
  candle_patterns: string[];
  entry_rules: any; exit_rules: any; risk_rules: any;
  fee_pct: number; use_count: number; total_fee_earned: number;
  win_rate: number|null; total_pnl: number; created_at: string;
}

const CATEGORIES = ['Moving Averages','Momentum','Volatility','Volume','Trend','ICT'];

// ── Indicator picker ────────────────────────────────────────────────────
function IndicatorPicker({ selected, onToggle }:{ selected:{id:string;params:Record<string,number>}[]; onToggle:(id:string,params?:Record<string,number>)=>void }) {
  const [cat, setCat] = useState('Momentum');
  const [expanded, setExpanded] = useState<string|null>(null);
  const [params, setParams] = useState<Record<string,Record<string,number>>>({});

  const isSelected = (id:string) => selected.some(s=>s.id===id);

  const toggle = (ind: IndicatorMeta) => {
    if(isSelected(ind.id)) { onToggle(ind.id); return; }
    const defaultParams = ind.params.reduce((a,p)=>({...a,[p.key]:p.default}),{});
    setParams(prev=>({...prev,[ind.id]:prev[ind.id]??defaultParams}));
    if(ind.params.length>0) setExpanded(expanded===ind.id?null:ind.id);
    else onToggle(ind.id, defaultParams);
  };

  const confirmAdd = (ind: IndicatorMeta) => {
    onToggle(ind.id, params[ind.id]);
    setExpanded(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map(c=>(
          <button key={c} onClick={()=>setCat(c)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${cat===c?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/30':'border border-white/[0.07] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {INDICATOR_LIBRARY.filter(i=>i.category===cat).map(ind=>(
          <div key={ind.id} className={`rounded-xl border p-2.5 transition-all ${isSelected(ind.id)?'border-[#2BFFF1]/40 bg-[#2BFFF1]/08':'border-white/[0.06] bg-white/[0.02]'}`}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#F4F6FA]">{ind.name}</p>
                <p className="text-[9px] text-[#4B5563] truncate">{ind.description}</p>
              </div>
              <button onClick={()=>toggle(ind)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ml-2 flex-shrink-0 transition-all text-xs font-black ${isSelected(ind.id)?'bg-[#2BFFF1]/20 text-[#2BFFF1]':'bg-white/[0.05] text-[#4B5563] hover:text-[#2BFFF1]'}`}>
                {isSelected(ind.id)?'✓':'+'}
              </button>
            </div>
            {expanded===ind.id&&!isSelected(ind.id)&&(
              <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
                {ind.params.map(p=>(
                  <div key={p.key} className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-[#4B5563]">{p.label}</span>
                    <input type="number" min={p.min} max={p.max}
                      value={params[ind.id]?.[p.key]??p.default}
                      onChange={e=>setParams(prev=>({...prev,[ind.id]:{...prev[ind.id],[p.key]:parseFloat(e.target.value)||p.default}}))}
                      className="w-16 bg-[#05060B] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-[#F4F6FA] outline-none text-right"/>
                  </div>
                ))}
                <button onClick={()=>confirmAdd(ind)} className="w-full py-1 rounded-lg text-[10px] font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Add with settings</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bot card ──────────────────────────────────────────────────────────────
function BotCard({ bot, onEdit, onActivate, onDelete }:{ bot:CustomBot; onEdit:()=>void; onActivate:()=>void; onDelete:()=>void }) {
  const statusColor = { lab:'#F59E0B', active:'#4ADE80', paused:'#6B7280', archived:'#374151' }[bot.status];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2.5">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-black text-[#F4F6FA] truncate">{bot.name}</p>
            {bot.is_public&&<span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#2BFFF1]/10 text-[#2BFFF1] border border-[#2BFFF1]/20 flex-shrink-0">Public</span>}
          </div>
          <p className="text-[10px] text-[#4B5563] mt-0.5 truncate">{bot.description||'No description'}</p>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ml-2" style={{color:statusColor,borderColor:statusColor+'40',background:statusColor+'15'}}>
          {bot.status.charAt(0).toUpperCase()+bot.status.slice(1)}
        </span>
      </div>
      <div className="flex gap-3 text-[9px]">
        <div className="text-center"><p className="text-[#4B5563]">Indicators</p><p className="font-bold text-[#F4F6FA]">{bot.indicators.length}</p></div>
        <div className="text-center"><p className="text-[#4B5563]">Patterns</p><p className="font-bold text-[#F4F6FA]">{bot.candle_patterns.length}</p></div>
        <div className="text-center"><p className="text-[#4B5563]">Fee</p><p className="font-bold text-[#F4F6FA]">{(bot.fee_pct*100).toFixed(1)}%</p></div>
        <div className="text-center"><p className="text-[#4B5563]">Uses</p><p className="font-bold text-[#F4F6FA]">{bot.use_count}</p></div>
        {bot.total_pnl!==0&&<div className="text-center"><p className="text-[#4B5563]">PnL</p><p className={`font-bold ${bot.total_pnl>=0?'text-green-400':'text-red-400'}`}>${Math.abs(bot.total_pnl).toFixed(0)}</p></div>}
      </div>
      <div className="flex gap-1.5">
        <button onClick={onEdit} className="flex-1 py-1.5 rounded-xl text-[10px] font-bold border border-white/[0.08] text-[#A7B0B7] hover:border-white/20 transition-all">Edit</button>
        {bot.status==='lab'&&<button onClick={onActivate} className="flex-1 py-1.5 rounded-xl text-[10px] font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Deploy</button>}
        {bot.status==='active'&&<button onClick={onActivate} className="flex-1 py-1.5 rounded-xl text-[10px] font-bold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20 transition-all">Pause</button>}
        {bot.status==='paused'&&<button onClick={onActivate} className="flex-1 py-1.5 rounded-xl text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 transition-all">Resume</button>}
        <button onClick={onDelete} className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-red-400/60 border border-red-500/15 hover:text-red-400 transition-all">✕</button>
      </div>
    </div>
  );
}

// ── Bot editor form ────────────────────────────────────────────────────────
function BotEditor({ bot, onSave, onCancel }:{ bot:Partial<CustomBot>|null; onSave:(b:any)=>void; onCancel:()=>void }) {
  const [name, setName]           = useState(bot?.name??'');
  const [desc, setDesc]           = useState(bot?.description??'');
  const [isPublic, setPublic]     = useState(bot?.is_public??false);
  const [feePct, setFeePct]       = useState((bot?.fee_pct??0)*100);
  const [indicators, setInds]     = useState<{id:string;params:Record<string,number>}[]>(bot?.indicators??[]);
  const [patterns, setPatterns]   = useState<string[]>(bot?.candle_patterns??[]);
  const [tab, setTab]             = useState<'indicators'|'patterns'|'rules'>('indicators');
  const [entryLogic, setEntry]    = useState<'AND'|'OR'>(bot?.entry_rules?.logic??'AND');
  const [exitMode, setExit]       = useState<string>(bot?.exit_rules?.mode??'tp_sl');
  const [tp, setTp]               = useState(bot?.exit_rules?.tp_pct??5);
  const [sl, setSl]               = useState(bot?.exit_rules?.sl_pct??2);
  const [maxPos, setMaxPos]       = useState(bot?.risk_rules?.max_position_pct??10);

  const toggleInd = (id:string, params?:Record<string,number>) => {
    setInds(prev=>prev.some(s=>s.id===id)?prev.filter(s=>s.id!==id):[...prev,{id,params:params??{}}]);
  };
  const togglePat = (p:string) => setPatterns(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p]);

  const save = () => {
    if(!name.trim()) return;
    onSave({ name:name.trim(), description:desc.trim(), is_public:isPublic, fee_pct:feePct/100, indicators, candle_patterns:patterns, entry_rules:{logic:entryLogic}, exit_rules:{mode:exitMode,tp_pct:tp,sl_pct:sl}, risk_rules:{max_position_pct:maxPos} });
  };

  const inputCls = "w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40";

  return (
    <div className="fixed inset-0 z-[150] flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm p-3" onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div>
            <p className="text-sm font-black text-[#F4F6FA]">{bot?.id ? 'Edit Bot' : 'Create Bot in The Lab'}</p>
            <p className="text-[10px] text-[#374151]">Build your custom trading strategy</p>
          </div>
          <button onClick={onCancel} className="text-[#4B5563] hover:text-[#A7B0B7] p-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Name & desc */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="text-[10px] text-[#4B5563] block mb-1">Bot Name *</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="My Alpha Bot" className={inputCls}/>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-[#4B5563] block mb-1">Description</label>
              <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Briefly describe your strategy" className={inputCls}/>
            </div>
          </div>

          {/* Settings row */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1">Fee (%)</label>
              <input type="number" min={0} max={5} step={0.1} value={feePct} onChange={e=>setFeePct(parseFloat(e.target.value)||0)} className={inputCls}/>
            </div>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1">Max position %</label>
              <input type="number" min={1} max={100} value={maxPos} onChange={e=>setMaxPos(parseFloat(e.target.value)||10)} className={inputCls}/>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-[#4B5563] block mb-1">Visibility</label>
              <button onClick={()=>setPublic(p=>!p)} className={`flex-1 rounded-xl border text-xs font-bold transition-all ${isPublic?'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/30':'border-white/[0.08] text-[#6B7280]'}`}>
                {isPublic?'Public':'Private'}
              </button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
            {(['indicators','patterns','rules'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-all ${tab===t?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {t==='indicators'?`Indicators (${indicators.length})`:t==='patterns'?`Patterns (${patterns.length})`:'Rules'}
              </button>
            ))}
          </div>

          {tab==='indicators'&&<IndicatorPicker selected={indicators} onToggle={toggleInd}/>}

          {tab==='patterns'&&(
            <div className="grid grid-cols-2 gap-1.5">
              {CANDLE_PATTERNS.map(p=>(
                <button key={p} onClick={()=>togglePat(p)}
                  className={`py-2 rounded-xl text-[10px] font-semibold border transition-all text-left px-3 ${patterns.includes(p)?'border-[#2BFFF1]/40 bg-[#2BFFF1]/08 text-[#2BFFF1]':'border-white/[0.06] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                  {patterns.includes(p)?'✓ ':''}{p}
                </button>
              ))}
            </div>
          )}

          {tab==='rules'&&(
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[#4B5563] font-semibold mb-1">Entry Logic</p>
                <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                  {(['AND','OR'] as const).map(l=>(
                    <button key={l} onClick={()=>setEntry(l)} className={`flex-1 py-2 text-xs font-bold transition-all ${entryLogic===l?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563]'}`}>
                      {l} — {l==='AND'?'All signals must agree':'Any signal triggers'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-[#4B5563] font-semibold mb-1">Exit Mode</p>
                <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                  {[['tp_sl','TP/SL'],['trailing','Trailing'],['signal','Signal reversal']].map(([v,l])=>(
                    <button key={v} onClick={()=>setExit(v)} className={`flex-1 py-2 text-[10px] font-bold transition-all ${exitMode===v?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563]'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] text-[#4B5563] block mb-1">Take Profit %</label><input type="number" min={0.1} max={100} step={0.5} value={tp} onChange={e=>setTp(parseFloat(e.target.value)||5)} className={inputCls}/></div>
                <div><label className="text-[10px] text-[#4B5563] block mb-1">Stop Loss %</label><input type="number" min={0.1} max={50} step={0.5} value={sl} onChange={e=>setSl(parseFloat(e.target.value)||2)} className={inputCls}/></div>
              </div>
              {feePct>0&&<div className="rounded-xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/05 px-3 py-2"><p className="text-[10px] text-[#2BFFF1]/70">Your bot charges {feePct.toFixed(1)}% on top of Xenia's base fee. This is collected when others use your public bot.</p></div>}
            </div>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-white/[0.06] flex-shrink-0">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-xs text-[#4B5563] hover:text-[#A7B0B7] transition-all">Cancel</button>
          <button onClick={save} disabled={!name.trim()||indicators.length===0} className="flex-1 py-2.5 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
            {bot?.id?'Save Changes':'Create Bot'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Lab Page ──────────────────────────────────────────────────────────
export function BotLabPage() {
  const { user } = useAuth();
  const [bots,     setBots]    = useState<CustomBot[]>([]);
  const [loading,  setLoading] = useState(true);
  const [editing,  setEditing] = useState<Partial<CustomBot>|null|'new'>(null);
  const [tab,      setTab]     = useState<'lab'|'active'|'market'>('lab');

  const load = async () => {
    if(!supabase||!user){setLoading(false);return;}
    setLoading(true);
    const {data}=await supabase.from('custom_bots').select('*').eq('user_id',user.id).order('created_at',{ascending:false});
    setBots((data??[]) as CustomBot[]);
    setLoading(false);
  };

  // Load on mount + when user changes
  useEffect(()=>{ load(); },[user]);

  // Reload when a bot is created from XeniaBot (custom DOM event)
  useEffect(()=>{
    const handler = () => { load(); };
    window.addEventListener('xenia:bot-created', handler);
    return () => window.removeEventListener('xenia:bot-created', handler);
  },[user]);

  // Also reload when the component becomes visible (tab focus / navigation)
  useEffect(()=>{
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  },[user]);

  const save = async (data:any) => {
    if(!supabase||!user) return;
    const isEdit = typeof editing==='object'&&editing!==null&&(editing as CustomBot).id;
    if(isEdit) await supabase.from('custom_bots').update({...data,updated_at:new Date().toISOString()}).eq('id',(editing as CustomBot).id);
    else await supabase.from('custom_bots').insert({...data,user_id:user.id,status:'lab'});
    setEditing(null); await load();
  };

  const activate = async (bot:CustomBot) => {
    if(!supabase) return;
    const next = bot.status==='lab'||bot.status==='paused'?'active':'paused';
    await supabase.from('custom_bots').update({status:next}).eq('id',bot.id);
    await load();
  };

  const del = async (id:string) => {
    if(!supabase||!confirm('Delete this bot?')) return;
    await supabase.from('custom_bots').delete().eq('id',id);
    await load();
  };

  const labBots    = bots.filter(b=>b.status==='lab');
  const activeBots = bots.filter(b=>b.status==='active'||b.status==='paused');

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">
      {editing!==null&&<BotEditor bot={editing==='new'?{}:editing as Partial<CustomBot>} onSave={save} onCancel={()=>setEditing(null)}/>}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex-1">
          <p className="text-sm font-black text-[#F4F6FA]">The Lab</p>
          <p className="text-[10px] text-[#374151]">Build, test, and deploy custom bots</p>
        </div>
        <button onClick={()=>setEditing('new')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Bot
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        {([['lab',`Lab (${labBots.length})`],['active',`My Bots (${activeBots.length})`],['market','Bot Market']] as const).map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} className={`flex-1 py-2 text-[11px] font-semibold transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{l}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!user?(
          <div className="text-center py-12"><p className="text-sm text-[#4B5563]">Sign in to create bots</p></div>
        ):loading?(
          <div className="flex items-center justify-center py-10 gap-2 text-[#4B5563]"><div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs">Loading bots…</span></div>
        ):(
          <>
            {tab==='lab'&&(
              labBots.length===0?(
                <div className="text-center py-12">
                  <svg className="mx-auto opacity-20 mb-3" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.2"><path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 11-8 0"/></svg>
                  <p className="text-sm font-semibold text-[#4B5563]">No bots in the lab yet</p>
                  <p className="text-[10px] text-[#374151] mt-1">Build your first custom bot with any indicator combination</p>
                  <button onClick={()=>setEditing('new')} className="mt-4 px-5 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Start Building</button>
                </div>
              ):labBots.map(b=><BotCard key={b.id} bot={b} onEdit={()=>setEditing(b)} onActivate={()=>activate(b)} onDelete={()=>del(b.id)}/>)
            )}
            {tab==='active'&&(
              activeBots.length===0?(
                <div className="text-center py-12"><p className="text-sm text-[#4B5563]">No active bots yet</p><p className="text-[10px] text-[#374151] mt-1">Build a bot in The Lab, then Deploy it</p></div>
              ):activeBots.map(b=><BotCard key={b.id} bot={b} onEdit={()=>setEditing(b)} onActivate={()=>activate(b)} onDelete={()=>del(b.id)}/>)
            )}
            {tab==='market'&&(
              <div className="space-y-3">
                <div className="rounded-xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/05 px-4 py-3">
                  <p className="text-xs font-semibold text-[#2BFFF1]">Bot Marketplace</p>
                  <p className="text-[10px] text-[#6B7280] mt-0.5">Discover and use community-built public bots. Creators earn a fee when their bot is used.</p>
                </div>
                <div className="text-center py-8"><p className="text-sm text-[#4B5563]">No public bots yet — be the first to publish one!</p></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
