import { useState, useEffect, useCallback, useRef } from 'react';

type MarketTab = 'favourites' | 'hot' | 'new' | 'gainers' | 'losers' | 'volume' | 'marketcap';

interface Token {
  address:string; name:string; symbol:string; price:number; change24h:number;
  volume24h:number; mcap:number; age:number; pairAddress:string; imageUrl:string;
}

const KNOWN_TOKENS = [
  { address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',symbol:'BONK',    name:'Bonk',                img:'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg' },
  { address:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',symbol:'WIF',     name:'dogwifhat',           img:'https://assets.coingecko.com/coins/images/33566/small/wif.png' },
  { address:'7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',symbol:'POPCAT',  name:'Popcat',              img:'https://assets.coingecko.com/coins/images/39580/small/popcat.png' },
  { address:'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREkzUo8THF', symbol:'MEW',     name:'cat in a dogs world', img:'https://assets.coingecko.com/coins/images/36180/small/mew.png' },
  { address:'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',symbol:'BOME',    name:'Book of Meme',        img:'https://assets.coingecko.com/coins/images/36071/small/bome.png' },
  { address:'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',symbol:'GOAT',   name:'Goat of All Time',    img:'https://assets.coingecko.com/coins/images/41211/small/goat.png' },
  { address:'2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',symbol:'PNUT',   name:'Peanut the Squirrel', img:'https://assets.coingecko.com/coins/images/41169/small/pnut.png' },
  { address:'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzc8yy',symbol:'MOODENG',name:'Moo Deng',            img:'https://assets.coingecko.com/coins/images/40791/small/moodeng.jpg' },
  { address:'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol:'JTO',    name:'Jito',                img:'https://assets.coingecko.com/coins/images/33228/small/jto.png' },
  { address:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol:'JUP',    name:'Jupiter',             img:'https://assets.coingecko.com/coins/images/35285/small/jup.png' },
];
const IMG_BY_SYM: Record<string,string> = Object.fromEntries(KNOWN_TOKENS.map(t=>[t.symbol.toUpperCase(),t.img]));

const MIN_MCAP = 30_000; // $30k minimum

const fmt = (n:number) => { if(!n||n<=0) return '—'; if(n>=1e9) return `$${(n/1e9).toFixed(2)}B`; if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${n.toFixed(2)}`; };
const fmtP = (p:number):string => { if(!p||p<=0) return '$—'; if(p>=1e9) return `$${(p/1e9).toFixed(2)}B`; if(p>=1e6) return `$${(p/1e6).toFixed(2)}M`; if(p>=1000) return `$${p.toFixed(2)}`; if(p>=1) return `$${p.toFixed(4)}`; if(p>=0.01) return `$${p.toFixed(6)}`; if(p>=0.0001) return `$${p.toFixed(8)}`; return `$${p.toFixed(10)}`; };

function parsePair(p:any, fallback=''): Token|null {
  if(!p?.baseToken?.symbol||!p?.baseToken?.name) return null;
  const price=parseFloat(p.priceUsd||'0'); if(price<=0) return null;
  const mcap=parseFloat(p.marketCap||p.fdv||'0');
  if(mcap > 0 && mcap < MIN_MCAP) return null; // filter $30k mcap
  const sym=(p.baseToken.symbol||'').toUpperCase();
  const img=p.info?.imageUrl||IMG_BY_SYM[sym]||fallback;
  if(!img) return null;
  return {
    address:p.baseToken.address, name:p.baseToken.name, symbol:p.baseToken.symbol, price,
    change24h:parseFloat(p.priceChange?.h24||'0'), volume24h:parseFloat(p.volume?.h24||'0'),
    mcap, age:p.pairCreatedAt?(Date.now()-p.pairCreatedAt)/3_600_000:999,
    pairAddress:p.pairAddress||p.baseToken.address, imageUrl:img,
  };
}

async function fetchKnown(): Promise<Token[]> {
  try {
    const addrs=KNOWN_TOKENS.map(t=>t.address).join(',');
    const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addrs}`);
    if(!r.ok) return fallbackKnown();
    const d=await r.json(); const seen=new Set<string>(); const tokens:Token[]=[];
    for(const p of (d.pairs||[])) {
      if(p.chainId!=='solana') continue;
      const sym=(p.baseToken?.symbol||'').toUpperCase(); if(seen.has(sym)) continue;
      const k=KNOWN_TOKENS.find(t=>t.symbol.toUpperCase()===sym);
      const tok=parsePair(p,k?.img||''); if(tok){tokens.push(tok);seen.add(sym);}
    }
    // Ensure all known appear
    for(const k of KNOWN_TOKENS) { if(!seen.has(k.symbol.toUpperCase())) tokens.push({address:k.address,name:k.name,symbol:k.symbol,price:0,change24h:0,volume24h:0,mcap:0,age:999,pairAddress:k.address,imageUrl:k.img}); }
    return tokens;
  } catch { return fallbackKnown(); }
}

function fallbackKnown(): Token[] {
  return KNOWN_TOKENS.map(k=>({address:k.address,name:k.name,symbol:k.symbol,price:0,change24h:0,volume24h:0,mcap:0,age:999,pairAddress:k.address,imageUrl:k.img}));
}

// Search includes Pump.fun, Raydium, all Solana DEXes
async function fetchSearch(q:string, limit=80): Promise<Token[]> {
  try {
    const r=await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
    if(!r.ok) return [];
    const d=await r.json(); const seen=new Set<string>(); const tokens:Token[]=[];
    for(const p of (d.pairs||[]).slice(0,limit*2)) {
      if(p.chainId!=='solana') continue;
      const sym=(p.baseToken?.symbol||'').toUpperCase(); if(seen.has(sym)) continue;
      const tok=parsePair(p); if(tok){tokens.push(tok);seen.add(sym);}
      if(tokens.length>=limit) break;
    }
    return tokens;
  } catch { return []; }
}

const TABS:{id:MarketTab;label:string}[]=[{id:'favourites',label:'★ Favs'},{id:'hot',label:'🔥 Hot'},{id:'new',label:'🆕 New'},{id:'gainers',label:'▲ Gainers'},{id:'losers',label:'▼ Losers'},{id:'volume',label:'📊 Vol'},{id:'marketcap',label:'💰 MCap'}];

function TokImg({src,sym}:{src:string;sym:string}) {
  const [e,setE]=useState(false);
  return <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden bg-[#0D1117] border border-white/[0.05]">{!e?<img src={src} alt={sym} className="w-full h-full object-cover" onError={()=>setE(true)}/>:<div className="w-full h-full flex items-center justify-center text-[9px] font-black text-[#2BFFF1]">{sym.slice(0,3)}</div>}</div>;
}

interface Props{onTrade:(id:string,addr:string)=>void;favourites:string[];onToggleFav:(a:string)=>void;}

export function MarketsPage({onTrade,favourites,onToggleFav}:Props) {
  const [tab,setTab]=useState<MarketTab>('hot');
  const [tokens,setTokens]=useState<Token[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [searchResults,setSearchResults]=useState<Token[]>([]);
  const [searching,setSearching]=useState(false);
  const gen=useRef(0);
  const searchTimer=useRef<ReturnType<typeof setTimeout>>();

  const load=useCallback(async()=>{
    const id=++gen.current; setLoading(true);
    let results:Token[]=[];
    if(tab==='new'){results=await fetchSearch('solana pump new token launch 2025',80);}
    else{
      const[known,extra]=await Promise.all([fetchKnown(),fetchSearch('solana meme bonk wif popcat pump raydium',60)]);
      const seen=new Set(known.map(t=>t.symbol.toUpperCase()));
      results=[...known,...extra.filter(t=>!seen.has(t.symbol.toUpperCase()))];
    }
    if(id===gen.current){setTokens(results);setLoading(false);}
  },[tab]);

  useEffect(()=>{load();const iv=setInterval(load,30_000);return()=>clearInterval(iv);},[load]);

  // Live search
  useEffect(()=>{
    if(!search.trim()){setSearchResults([]);return;}
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current=setTimeout(async()=>{
      const r=await fetchSearch(search,60);
      setSearchResults(r);
      setSearching(false);
    },400);
  },[search]);

  const baseList = search ? searchResults : tokens;

  const display=baseList
    .filter(t=>tab==='favourites'?favourites.includes(t.address):true)
    .sort((a,b)=>{
      if(tab==='gainers')   return b.change24h-a.change24h;
      if(tab==='losers')    return a.change24h-b.change24h;
      if(tab==='new')       return a.age-b.age;
      if(tab==='volume')    return b.volume24h-a.volume24h;
      if(tab==='marketcap') return b.mcap-a.mcap;
      return b.volume24h-a.volume24h;
    })
    .slice(0,120);

  const C={star:'w-6 flex-shrink-0',tok:'flex-1 min-w-0',price:'w-[92px] flex-shrink-0',chg:'w-[72px] flex-shrink-0',vol:'w-[80px] flex-shrink-0 hidden sm:block',mc:'w-[76px] flex-shrink-0 hidden md:block',act:'w-[60px] flex-shrink-0'};

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">
      {/* Tabs + search */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 overflow-x-auto flex-shrink-0 border-b border-white/[0.06]">
        {TABS.map(t=><button key={t.id} onClick={()=>{setTab(t.id);}} className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab===t.id?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{t.label}</button>)}
        <div className="ml-auto flex-shrink-0 relative">
          <input placeholder="Search Pump.fun, Raydium…" value={search} onChange={e=>setSearch(e.target.value)}
            className="w-40 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
          {searching && <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] flex-shrink-0">
        <div className={C.star}/>
        <div className={`${C.tok} text-[10px] font-semibold uppercase tracking-widest text-[#374151]`}>Token</div>
        <div className={`${C.price} text-[10px] font-semibold uppercase tracking-widest text-[#374151] text-right`}>Price</div>
        <div className={`${C.chg} text-[10px] font-semibold uppercase tracking-widest text-[#374151] text-right`}>24h</div>
        <div className={`${C.vol} text-[10px] font-semibold uppercase tracking-widest text-[#374151] text-right`}>Volume</div>
        <div className={`${C.mc} text-[10px] font-semibold uppercase tracking-widest text-[#374151] text-right`}>MCap</div>
        <div className={`${C.act} text-[10px] font-semibold uppercase tracking-widest text-[#374151] text-right`}>Action</div>
      </div>

      {/* Rows — IMPORTANT: overflow-y-auto on this div, height set to fill */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {(loading && !search) ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3 text-[#4B5563]">
            <div className="w-6 h-6 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
            <span className="text-xs">Loading Solana tokens…</span>
          </div>
        ) : display.length===0 ? (
          <div className="flex items-center justify-center h-32 text-[#4B5563] text-sm">
            {tab==='favourites'?'No favourites — tap ★ to save':search?'No results found':'No tokens found'}
          </div>
        ) : display.map(t=>{
          const fav=favourites.includes(t.address); const up=t.change24h>=0;
          return (
            <div key={t.pairAddress} className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.025] transition-all border-b border-white/[0.03]">
              <button onClick={()=>onToggleFav(t.address)} className={`${C.star} text-sm leading-none transition-colors ${fav?'text-yellow-400':'text-[#1E2530] hover:text-yellow-400'}`}>★</button>
              <div className={`${C.tok} flex items-center gap-2`}>
                <TokImg src={t.imageUrl} sym={t.symbol}/>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#F4F6FA] truncate leading-tight">{t.symbol}</p>
                  <p className="text-[9px] text-[#374151] truncate leading-tight">{t.name}</p>
                </div>
              </div>
              <div className={`${C.price} text-right`}><p className="text-xs font-semibold text-[#F4F6FA]">{fmtP(t.price)}</p></div>
              <div className={`${C.chg} text-right`}><span className={`text-xs font-bold ${up?'text-green-400':'text-red-400'}`}>{up?'+':''}{t.change24h.toFixed(2)}%</span></div>
              <div className={`${C.vol} text-right`}><p className="text-xs text-[#6B7280]">{fmt(t.volume24h)}</p></div>
              <div className={`${C.mc} text-right`}><p className="text-xs text-[#6B7280]">{fmt(t.mcap)}</p></div>
              <div className={`${C.act} text-right`}><button onClick={()=>onTrade(t.address,t.address)} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Trade</button></div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 border-t border-white/[0.04] flex-shrink-0 flex items-center justify-between">
        <span className="text-[9px] text-[#2D3748]">DexScreener · Pump.fun · Raydium · {display.length} tokens · 30s</span>
        <span className="text-[9px] text-[#2BFFF1]/25">$30k+ MCap · Images only</span>
      </div>
    </div>
  );
}
