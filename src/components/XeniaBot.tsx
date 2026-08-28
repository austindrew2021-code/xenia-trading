import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
// NEW: validate what the model returns before it reaches the database.
import { validateBotConfig, summarizeIssues, ValidationResult } from '../lib/botConfigValidator';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

interface Msg { role: 'user' | 'assistant'; content: string; }

interface BotConfig {
  name: string;
  description: string;
  indicators: { id: string; params: Record<string, number> }[];
  candle_patterns: string[];
  entry_rules: any;
  exit_rules: any;
  risk_rules: any;
}

// ── Xenia mascot ──────────────────────────────────────────────────────────
export function XeniaMascot({ size = 36, glow = false, pulse = false }: { size?: number; glow?: boolean; pulse?: boolean }) {
  return (
    <div className={`relative flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        {glow && <circle cx="24" cy="24" r="22" fill="rgba(43,255,241,0.12)" className="animate-pulse"/>}
        <rect x="6" y="10" width="36" height="30" rx="8" fill="#0B0E14" stroke="#2BFFF1" strokeWidth="1.5"/>
        <line x1="24" y1="10" x2="24" y2="4" stroke="#2BFFF1" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="24" cy="3" r="2" fill="#2BFFF1"/>
        <rect x="13" y="18" width="8" height="6" rx="2" fill="#2BFFF1" opacity="0.9"/>
        <rect x="27" y="18" width="8" height="6" rx="2" fill="#2BFFF1" opacity="0.9"/>
        <rect x="16" y="20" width="3" height="3" rx="1" fill="#05060B"/>
        <rect x="30" y="20" width="3" height="3" rx="1" fill="#05060B"/>
        <path d="M16 31 Q24 36 32 31" stroke="#2BFFF1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <circle cx="12" cy="29" r="2" fill="#2BFFF1" opacity="0.4"/>
        <circle cx="36" cy="29" r="2" fill="#2BFFF1" opacity="0.4"/>
      </svg>
    </div>
  );
}

// ── Bot creation confirmation card ────────────────────────────────────────
function BotCreateCard({ config, validation, onConfirm, onDismiss }: {
  config: BotConfig;
  /** NEW: what the validator changed and what it wants the user to know. */
  validation: ValidationResult | null;
  /** CHANGED: returns whether the save actually succeeded. See the note below. */
  onConfirm: (name: string, isPublic: boolean, feePct: number) => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [name,     setName]     = useState(config.name ?? '');
  const [isPublic, setPublic]   = useState(false);
  const [feePct,   setFeePct]   = useState(0);
  const [saving,   setSaving]   = useState(false);
  const [done,     setDone]     = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const { user: cardUser } = useAuth();

  /* CHANGED. The old version was:

         await onConfirm(name.trim(), isPublic, feePct);
         if (cardUser) setDone(true);

     with the parent's handler doing `await createBot(...); setPendingBot(null)`.
     Clearing pendingBot unmounts this card, so setDone(true) landed on a dead
     component and the "Bot created!" screen never appeared — the card just
     vanished. The parent now leaves the card mounted and this waits on a real
     success/failure result. */
  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const ok = await onConfirm(name.trim(), isPublic, feePct);
    setSaving(false);
    if (ok) setDone(true);
  };

  if (done) return (
    <div className="rounded-2xl border border-green-500/30 bg-green-500/08 p-4 text-center space-y-2">
      <XeniaMascot size={36} glow/>
      <p className="text-sm font-black text-green-400">Bot created!</p>
      <p className="text-[10px] text-[#6B7280]">Find it in The Lab section. Deploy when ready.</p>
      <button onClick={onDismiss} className="text-[10px] text-[#4B5563] hover:text-[#A7B0B7] underline">Dismiss</button>
    </div>
  );

  const errors   = validation?.issues.filter(i => i.severity === 'error')   ?? [];
  const warnings = validation?.issues.filter(i => i.severity === 'warning') ?? [];

  return (
    <div className="rounded-2xl border border-[#2BFFF1]/30 bg-[#2BFFF1]/04 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <XeniaMascot size={28} glow/>
        <div>
          <p className="text-xs font-black text-[#F4F6FA]">Bot Ready to Create</p>
          <p className="text-[9px] text-[#4B5563]">Review and confirm before saving to The Lab</p>
        </div>
      </div>

      {/* Strategy summary */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5 space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {config.indicators.map(ind => (
            <span key={ind.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#2BFFF1]/10 text-[#2BFFF1] border border-[#2BFFF1]/20 font-semibold">{ind.id.toUpperCase()}</span>
          ))}
          {config.candle_patterns.map(p => (
            <span key={p} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20 font-semibold">{p}</span>
          ))}
        </div>
        <div className="flex gap-3 text-[9px] text-[#4B5563]">
          <span>Entry: <span className="text-[#F4F6FA]">{config.entry_rules?.logic ?? 'AND'}</span></span>
          <span>TP: <span className="text-green-400">{config.exit_rules?.tp_pct ?? 5}%</span></span>
          <span>SL: <span className="text-red-400">{config.exit_rules?.sl_pct ?? 2}%</span></span>
          <span>Max pos: <span className="text-[#F4F6FA]">{config.risk_rules?.max_position_pct ?? 10}%</span></span>
        </div>
      </div>

      {/* NEW: what the validator changed, and what it wants flagged. Shown, not
          hidden — a config that was silently repaired is one the user should be
          able to inspect before it trades. */}
      {validation && validation.issues.length > 0 && (
        <div className="rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/[0.06] px-2.5 py-2 space-y-1">
          <button onClick={() => setShowIssues(v => !v)} className="w-full flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#F59E0B]">{summarizeIssues(validation)}</span>
            <span className="text-[9px] text-[#F59E0B]/60">{showIssues ? 'Hide' : 'Show'}</span>
          </button>
          {showIssues && (
            <div className="space-y-1 pt-1">
              {errors.map((i, k) => (
                <p key={`e${k}`} className="text-[9px] text-[#F59E0B] leading-snug">
                  · {i.message}{i.fix ? ` ${i.fix}` : ''}
                </p>
              ))}
              {warnings.map((i, k) => (
                <p key={`w${k}`} className="text-[9px] text-[#F59E0B]/70 leading-snug">· {i.message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Name */}
      <div>
        <label className="text-[9px] text-[#4B5563] block mb-1 font-semibold">BOT NAME</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name your bot…"
          className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"
        />
      </div>

      {/* Visibility + fee */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-[#4B5563] block mb-1 font-semibold">VISIBILITY</label>
          <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
            <button onClick={() => { setPublic(false); setFeePct(0); }} className={`flex-1 py-2 text-[10px] font-bold transition-all ${!isPublic ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>Private</button>
            <button onClick={() => setPublic(true)}  className={`flex-1 py-2 text-[10px] font-bold transition-all ${isPublic  ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>Public</button>
          </div>
        </div>
        <div>
          <label className="text-[9px] text-[#4B5563] block mb-1 font-semibold">YOUR FEE {isPublic ? '%' : '(N/A)'}</label>
          <div className="flex gap-1">
            {[0, 1, 2, 5].map(f => (
              <button key={f} onClick={() => setFeePct(f)} disabled={!isPublic}
                className={`flex-1 py-2 rounded-lg text-[9px] font-bold transition-all disabled:opacity-30 border ${feePct === f && isPublic ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/30' : 'border-white/[0.07] text-[#4B5563]'}`}>
                {f}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {isPublic && (
        <p className="text-[9px] text-[#F59E0B]/70 bg-[#F59E0B]/08 border border-[#F59E0B]/20 rounded-lg px-2.5 py-1.5">
          Public bots appear in the Bot Marketplace. You earn {feePct}% on others' profits when they use your bot. Xenia adds 0.1%.
        </p>
      )}

      {!cardUser && (
        <div className="rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/08 px-3 py-2 text-[10px] text-[#F59E0B]/80">
          Sign in first to save this bot to The Lab.
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onDismiss} className="px-3 py-2 rounded-xl border border-white/[0.08] text-[10px] text-[#4B5563] hover:text-[#A7B0B7] transition-all">Cancel</button>
        <button onClick={submit} disabled={saving || !name.trim()}
          className="flex-1 py-2 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
          {saving
            ? <span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Creating…</span>
            : cardUser ? 'Create Bot in The Lab' : 'Sign In to Create Bot'}
        </button>
      </div>
    </div>
  );
}

// ── Suggested prompts ─────────────────────────────────────────────────────
const SUGGESTED = [
  'Create me a bot using RSI and EMA crossover',
  'Build a bot for memecoin breakouts',
  'Make me an ICT order block bot',
  'Create a scalping bot with momentum indicators',
  'How do I read an order block?',
];

// ── Main widget ───────────────────────────────────────────────────────────
export function XeniaBotWidget() {
  const { user } = useAuth();
  const [open,     setOpen]     = useState(false);
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [usage,    setUsage]    = useState<{ messages_today: number; limit: number; remaining: number } | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  // Pending bot config waiting for user to confirm
  const [pendingBot, setPendingBot] = useState<BotConfig | null>(null);
  // NEW: the validator's verdict on that config.
  const [pendingValidation, setPendingValidation] = useState<ValidationResult | null>(null);
  // NEW: one auto-retry per config, so a bad response cannot loop.
  const retriedRef = useRef(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const sessionId = useRef(
    localStorage.getItem('xenia-session-id') ??
    (() => { const id = 'sess-' + Math.random().toString(36).slice(2); localStorage.setItem('xenia-session-id', id); return id; })()
  );

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, loading, pendingBot]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  const send = async (text = input.trim(), isRetry = false) => {
    if (!text || loading || limitHit) return;
    if (!isRetry) setInput('');
    const userMsg: Msg = { role: 'user', content: text };
    // A retry is a correction to the model, not something the user typed — keep
    // it out of the visible transcript but inside the conversation history.
    const next = [...msgs, userMsg];
    if (!isRetry) setMsgs(next);
    setLoading(true);

    try {
      let authHeader = '';
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) authHeader = `Bearer ${session.access_token}`;
      }

      const r = await fetch(`${SUPABASE_URL}/functions/v1/xenia-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
          'x-session-id': sessionId.current,
        },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });
      const d = await r.json();

      if (r.status === 429 || d.limit_reached) {
        setLimitHit(true);
        const tip = user ? 'Limit resets midnight UTC.' : 'Sign in for 30 messages/day.';
        setMsgs(prev => [...prev, { role: 'assistant', content: `Daily message limit reached (${d.limit}/day). ${tip}` }]);
      } else if (d.text) {
        if (!isRetry) setMsgs(prev => [...prev, { role: 'assistant', content: d.text }]);
        if (d.usage) setUsage(d.usage);
        if (d.bot_config) handleBotConfig(d.bot_config);
      } else {
        setMsgs(prev => [...prev, { role: 'assistant', content: 'Something went wrong fren, try again.' }]);
      }
    } catch {
      setMsgs(prev => [...prev, { role: 'assistant', content: 'Connection error. Check your internet.' }]);
    }
    setLoading(false);
  };

  /* ═══════════════════════════════════════════════════════════════════════
     NEW: VALIDATE BEFORE THE CARD, NOT AFTER THE INSERT

     The model's JSON used to go straight into the confirmation card and then
     straight into Supabase. Nothing checked that any of it was real.

     A model asked for "a bot using RSI divergence and Ichimoku cloud" will
     confidently return { id: 'rsi_divergence' } and { id: 'ichimoku_cloud' }.
     Neither is an indicator this platform computes. The insert succeeds, the bot
     appears in The Lab, the user deploys it — and it never fires. No error at any
     step. The user concludes the AI builder is broken, and they are right, but
     not in a way anyone can debug from the outside.

     Now: repair what is repairable (rsi_divergence -> rsi), drop what is not,
     and when the config cannot be salvaged, re-prompt the model with the exact
     list of valid ids. That retry usually succeeds, which makes the feature more
     reliable rather than more restricted.

     One retry only. A model that fails twice needs the user to rephrase, not an
     infinite loop against their daily message limit.
     ═══════════════════════════════════════════════════════════════════════ */
  const handleBotConfig = (raw: unknown) => {
    const result = validateBotConfig(raw, { barsAvailable: 500 });

    if (!result.valid && result.retryPrompt && !retriedRef.current) {
      retriedRef.current = true;
      setMsgs(prev => [...prev, {
        role: 'assistant',
        content: 'Some of those indicators are not ones I can actually run. Let me rebuild it properly…',
      }]);
      void send(result.retryPrompt, true);
      return;
    }

    if (!result.valid) {
      setMsgs(prev => [...prev, {
        role: 'assistant',
        content: 'I could not build a working bot from that — the indicators I picked are not ones '
          + 'this platform computes. Try naming the indicators directly, for example '
          + '"RSI and EMA crossover" or "Bollinger Bands with ATR stops".',
      }]);
      retriedRef.current = false;
      return;
    }

    retriedRef.current = false;
    setPendingValidation(result);
    setTimeout(() => setPendingBot(result.repaired as unknown as BotConfig), 300);
  };

  // Actually save the bot to Supabase
  // CHANGED: returns whether the save succeeded, so the card can show its
  // success state instead of being unmounted out from under itself.
  const createBot = async (name: string, isPublic: boolean, feePct: number): Promise<boolean> => {
    if (!supabase || !pendingBot) return false;
    if (!user) {
      setMsgs(prev => [...prev, {
        role: 'assistant',
        content: "You need to sign in before saving a bot to The Lab. Tap Sign In in the top right, then come back and I will create it for you."
      }]);
      setPendingBot(null);
      setPendingValidation(null);
      return false;
    }
    const { error } = await supabase.from('custom_bots').insert({
      user_id:         user.id,
      name,
      description:     pendingBot.description ?? '',
      status:          'lab',
      is_public:       isPublic,
      indicators:      pendingBot.indicators ?? [],
      candle_patterns: pendingBot.candle_patterns ?? [],
      entry_rules:     pendingBot.entry_rules ?? { logic: 'AND' },
      exit_rules:      pendingBot.exit_rules  ?? { mode: 'tp_sl', tp_pct: 5, sl_pct: 2 },
      risk_rules:      pendingBot.risk_rules  ?? { max_position_pct: 10 },
      // CHANGED: a private bot cannot earn a fee, so it must not carry one. The
      // fee state persisted when the user toggled Public -> Private, writing a
      // 5% fee onto a bot that is not in the marketplace.
      fee_pct:         isPublic ? feePct / 100 : 0,
      // NEW: mode is a property of the DEPLOYMENT, not of creation. Null here;
      // BotLabPage sets it when the bot is actually deployed. Without this, a bot
      // created while the app happened to be in live mode would inherit live.
      deployed_mode:   null,
    });
    if (error) {
      setMsgs(prev => [...prev, { role: 'assistant', content: `Failed to save: ${error.message}` }]);
      return false;
    }
    // Dispatch event so BotLabPage refreshes instantly
    window.dispatchEvent(new CustomEvent('xenia:bot-created'));
    // Friendly follow-up
    setMsgs(prev => [...prev, {
      role: 'assistant',
      content: `"${name}" is now in The Lab! Navigate to The Lab section to deploy it. You can edit indicators, TP/SL, and everything else there before going live.`
    }]);
    return true;
  };

  const dismissBot = () => { setPendingBot(null); setPendingValidation(null); };

  return (
    <>
      {/* Floating button */}
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
        <div
          className="fixed z-50 flex flex-col bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden"
          style={{ bottom: '88px', left: '8px', width: 'min(340px, calc(100vw - 16px))', height: 'min(500px, 72vh)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.07] flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #05060B, #0B0E14)' }}>
            <XeniaMascot size={28} glow/>
            <div className="flex-1">
              <p className="text-sm font-black text-[#F4F6FA]">Xenia AI</p>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
                <span className="text-[9px] text-green-400">Online · {usage?.remaining ?? '—'} msgs left today</span>
              </div>
            </div>
            <button onClick={() => { setMsgs([]); setLimitHit(false); setPendingBot(null); setPendingValidation(null); retriedRef.current = false; }}
              className="text-[9px] text-[#374151] hover:text-[#6B7280] px-1.5 py-0.5 rounded border border-white/[0.05]">Clear</button>
            <button onClick={() => setOpen(false)} className="text-[#4B5563] hover:text-[#A7B0B7] p-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <XeniaMascot size={22}/>
                  <div className="rounded-2xl rounded-tl-none bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-xs text-[#A7B0B7] max-w-[85%]">
                    Yo fren! I'm Xenia — ask me anything about trading, or say <span className="text-[#2BFFF1] font-semibold">"Create me a bot"</span> and I'll build one for you from scratch.
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
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#2BFFF1]/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }}/>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Bot creation confirmation */}
            {pendingBot && !loading && (
              <div className="pl-7">
                <BotCreateCard
                  config={pendingBot}
                  validation={pendingValidation}
                  /* CHANGED: no longer clears pendingBot here — that unmounted the
                     card before it could show its success state. Dismiss clears it. */
                  onConfirm={createBot}
                  onDismiss={dismissBot}
                />
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
              placeholder={pendingBot ? 'Confirm or adjust bot above…' : 'Ask Xenia anything…'}
              disabled={limitHit}
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 placeholder-[#374151] disabled:opacity-40"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading || limitHit}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg,#2BFFF1,#00c4ff)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#05060B" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
