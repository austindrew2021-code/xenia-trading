import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

interface Msg { role: 'user' | 'assistant'; content: string; }

// Xenia mascot SVG — stylised X robot face
function XeniaMascot({ size = 36, glow = false, pulse = false }: { size?: number; glow?: boolean; pulse?: boolean }) {
  return (
    <div className={`relative flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        {/* Glow */}
        {glow && <circle cx="24" cy="24" r="22" fill="rgba(43,255,241,0.12)" className="animate-pulse"/>}
        {/* Body/head */}
        <rect x="6" y="10" width="36" height="30" rx="8" fill="#0B0E14" stroke="#2BFFF1" strokeWidth="1.5"/>
        {/* Antenna */}
        <line x1="24" y1="10" x2="24" y2="4" stroke="#2BFFF1" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="24" cy="3" r="2" fill="#2BFFF1"/>
        {/* Eyes */}
        <rect x="13" y="18" width="8" height="6" rx="2" fill="#2BFFF1" opacity="0.9"/>
        <rect x="27" y="18" width="8" height="6" rx="2" fill="#2BFFF1" opacity="0.9"/>
        {/* Eye pupils */}
        <rect x="16" y="20" width="3" height="3" rx="1" fill="#05060B"/>
        <rect x="30" y="20" width="3" height="3" rx="1" fill="#05060B"/>
        {/* Smile */}
        <path d="M16 31 Q24 36 32 31" stroke="#2BFFF1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        {/* Cheek dots */}
        <circle cx="12" cy="29" r="2" fill="#2BFFF1" opacity="0.4"/>
        <circle cx="36" cy="29" r="2" fill="#2BFFF1" opacity="0.4"/>
        {/* X on chest */}
        <text x="24" y="28" textAnchor="middle" fill="#2BFFF1" fontSize="5" fontWeight="bold" opacity="0.3">X</text>
      </svg>
    </div>
  );
}

const SUGGESTED = [
  'How do I read an order block?',
  'Best TP/SL strategy for memecoins?',
  'Explain the IFVG bot strategy',
  'How do I copy trade on Xenia?',
  'What leverage should I use?',
];

export function XeniaBotWidget() {
  const { user } = useAuth();
  const [open,     setOpen]     = useState(false);
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text = input.trim()) => {
    if (!text || loading) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: text };
    const next = [...msgs, userMsg];
    setMsgs(next);
    setLoading(true);

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/xenia-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });
      const d = await r.json();
      if (d.text) setMsgs(prev => [...prev, { role: 'assistant', content: d.text }]);
      else setMsgs(prev => [...prev, { role: 'assistant', content: 'Sorry fren, something went wrong. Try again.' }]);
    } catch {
      setMsgs(prev => [...prev, { role: 'assistant', content: 'Connection error. Check your internet.' }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 left-4 z-40 md:bottom-6 md:left-6 focus:outline-none"
        title="Chat with Xenia AI"
      >
        <div className="relative">
          <XeniaMascot size={48} glow={!open} pulse={open}/>
          {!open && msgs.length > 0 && (
            <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#2BFFF1] border-2 border-[#05060B] animate-pulse"/>
          )}
        </div>
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed z-50 flex flex-col bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden"
          style={{ bottom: '88px', left: '8px', width: 'min(340px, calc(100vw - 16px))', height: 'min(480px, 70vh)' }}>

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.07] flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #05060B, #0B0E14)' }}>
            <XeniaMascot size={28} glow/>
            <div className="flex-1">
              <p className="text-sm font-black text-[#F4F6FA]">Xenia AI</p>
              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/><span className="text-[9px] text-green-400">Online</span></div>
            </div>
            <button onClick={() => { setMsgs([]); }} className="text-[9px] text-[#374151] hover:text-[#6B7280] px-1.5 py-0.5 rounded border border-white/[0.05]">Clear</button>
            <button onClick={() => setOpen(false)} className="text-[#4B5563] hover:text-[#A7B0B7] p-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <XeniaMascot size={22}/>
                  <div className="rounded-2xl rounded-tl-none bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-xs text-[#A7B0B7] max-w-[85%]">
                    Yo fren! I'm Xenia — your AI trading assistant. Ask me anything about charts, strategy, or how to use the platform.
                  </div>
                </div>
                <div className="space-y-1.5 pl-7">
                  {SUGGESTED.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="block w-full text-left text-[10px] text-[#2BFFF1] bg-[#2BFFF1]/08 border border-[#2BFFF1]/20 rounded-xl px-2.5 py-1.5 hover:bg-[#2BFFF1]/15 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 items-end ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role === 'assistant' && <XeniaMascot size={20}/>}
                <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'rounded-br-none bg-[#2BFFF1]/15 text-[#F4F6FA] border border-[#2BFFF1]/25'
                    : 'rounded-bl-none bg-white/[0.04] text-[#A7B0B7] border border-white/[0.06]'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2 items-end">
                <XeniaMascot size={20}/>
                <div className="rounded-2xl rounded-bl-none bg-white/[0.04] border border-white/[0.06] px-3 py-2">
                  <div className="flex gap-1 items-center">
                    {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#2BFFF1]/60 animate-bounce" style={{animationDelay:`${i*150}ms`}}/>)}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-white/[0.07] flex-shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ask Xenia anything…"
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 placeholder-[#374151]"
            />
            <button onClick={() => send()} disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg,#2BFFF1,#00c4ff)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#05060B" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export { XeniaMascot };
