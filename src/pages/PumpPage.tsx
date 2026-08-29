import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_PUMP_CONFIG, LogRecord, PumpConfig, PipelineMode,
} from '../pump/types';
import { TradeLog } from '../pump/pipeline';
import { canEnableLive, LIVE_RISK_DISCLOSURE } from '../pump/executor';

// Xenia palette, unchanged from the rest of the app.
const card = 'rounded-2xl border border-white/[0.05] bg-[#0D1117]/60';
const label = 'text-[10px] uppercase tracking-widest text-[#4B5563]';
const input = 'w-24 bg-[#0D1117] border border-white/[0.07] rounded-lg px-2 py-1 '
  + 'text-xs text-[#F4F6FA] text-right focus:border-[#2BFFF1]/40 outline-none';

function Num({ l, v, onChange, step = 1, hint }: {
  l: string; v: number; onChange: (n: number) => void; step?: number; hint?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1" title={hint}>
      <span className="text-[11px] text-[#A7B0B7]">{l}</span>
      <input type="number" value={v} step={step}
        onChange={e => onChange(parseFloat(e.target.value))} className={input}/>
    </label>
  );
}

export default function PumpPage() {
  const [cfg, setCfg] = useState<PumpConfig>(DEFAULT_PUMP_CONFIG);
  const [running, setRunning] = useState(false);
  const [showLiveDialog, setShowLiveDialog] = useState(false);
  const [ack, setAck] = useState(false);
  const [section, setSection] = useState<'run' | 'filter' | 'scoring' | 'risk' | 'agents'>('run');
  const [logs] = useState(() => new TradeLog(5000));
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [mockStartedAt, setMockStartedAt] = useState<number | null>(null);

  const set = <K extends keyof PumpConfig>(k: K, v: PumpConfig[K]) =>
    setCfg(c => ({ ...c, [k]: v }));

  const mockHours = mockStartedAt ? (Date.now() - mockStartedAt) / 3_600_000 : 0;
  const closed = records.filter(r => r.action === 'close').length;

  const gate = useMemo(() => canEnableLive({
    mockSessionHours: mockHours,
    mockTradesClosed: closed,
    hasRpcUrl: !!cfg.solana.rpcUrl,
    hasDataApiKey: !!cfg.data.apiKey,
    hasGrokApiKey: !!cfg.grok.apiKey,
    walletUnlocked: false,           // wire to walletSession.isUnlocked
    walletBackupConfirmed: false,    // wire to the active vault
    userAcknowledgedRisk: ack,
    fundedSol: 0,                    // wire to the live balance
  }), [cfg, mockHours, closed, ack]);

  const requestMode = useCallback((m: PipelineMode) => {
    if (m === 'mock') { set('mode', 'mock'); return; }
    setShowLiveDialog(true);
  }, []);

  const summary = logs.summary();

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#080B10] text-[#F4F6FA]">
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-black tracking-tight">Pump Pipeline</h1>
          <p className="text-[10px] text-[#4B5563]">
            Nine stages · four Grok agents · your wallet, your keys
          </p>
        </div>
        {/* mode toggle, top corner */}
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] p-0.5">
          {(['mock', 'live'] as PipelineMode[]).map(m => (
            <button key={m} onClick={() => requestMode(m)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                cfg.mode === m
                  ? m === 'live'
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : 'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/30'
                  : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {m === 'live' ? '● LIVE' : 'MOCK'}
            </button>
          ))}
        </div>
      </div>

      {cfg.mode === 'mock' && (
        <div className="mx-4 mb-2 rounded-xl border border-[#2BFFF1]/20 bg-[#2BFFF1]/[0.06] px-3 py-2">
          <p className="text-[10px] text-[#2BFFF1] leading-snug">
            Mock mode. Real prices, real agent calls, real scoring — no transaction is sent.
            Stop-loss and PnL are computed against the live market, so what you see is the
            strategy, not a simulator. What it cannot show you is slippage on your own size,
            MEV, or failed transactions. Expect live to be worse.
          </p>
        </div>
      )}

      <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
        {(['run', 'filter', 'scoring', 'risk', 'agents'] as const).map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold capitalize whitespace-nowrap ${
              section === s ? 'bg-white/[0.06] text-[#F4F6FA]' : 'text-[#4B5563]'}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="px-4 pb-6 space-y-3">
        {section === 'run' && (
          <>
            <div className={`${card} p-3`}>
              <div className="flex items-center justify-between mb-2">
                <p className={label}>Pipeline</p>
                <button
                  onClick={() => {
                    if (!running && !mockStartedAt) setMockStartedAt(Date.now());
                    setRunning(r => !r);
                  }}
                  className={`px-4 py-1.5 rounded-xl text-[11px] font-black border ${
                    running
                      ? 'border-red-500/30 bg-red-500/10 text-red-400'
                      : 'border-[#2BFFF1]/30 bg-[#2BFFF1]/10 text-[#2BFFF1]'}`}>
                  {running ? 'Stop' : 'Start'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div><span className="text-[#4B5563]">Considered</span>{' '}
                  <span className="font-bold">{summary.considered}</span></div>
                <div><span className="text-[#4B5563]">Bought</span>{' '}
                  <span className="font-bold">{summary.bought}</span></div>
                <div><span className="text-[#4B5563]">Closed</span>{' '}
                  <span className="font-bold">{summary.closed}</span></div>
              </div>
              {summary.warning && (
                <p className="mt-2 text-[10px] text-amber-400 leading-snug">{summary.warning}</p>
              )}
            </div>

            <div className={`${card} p-3`}>
              <p className={`${label} mb-2`}>Where the stream is going</p>
              {Object.entries(summary.bySkipReason).length === 0 ? (
                <p className="text-[10px] text-[#4B5563]">Nothing yet.</p>
              ) : Object.entries(summary.bySkipReason).map(([reason, n]) => (
                <div key={reason} className="flex items-center justify-between py-0.5">
                  <span className="text-[10px] text-[#6B7280]">{reason.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] font-mono text-[#A7B0B7]">{n}</span>
                </div>
              ))}
            </div>

            <div className={`${card} p-3`}>
              <p className={`${label} mb-2`}>Live readiness</p>
              {gate.ok ? (
                <p className="text-[10px] text-green-400">All conditions met.</p>
              ) : gate.blockers.map((b, i) => (
                <p key={i} className="text-[10px] text-[#6B7280] leading-relaxed">· {b}</p>
              ))}
            </div>
          </>
        )}

        {section === 'filter' && (
          <div className={`${card} p-3`}>
            <p className={`${label} mb-2`}>Basic filter</p>
            <Num l="Min unique buyers" v={cfg.filter.minUniqueBuyers}
              onChange={n => set('filter', { ...cfg.filter, minUniqueBuyers: n })}/>
            <Num l="Max curve %" v={cfg.filter.maxBondingCurvePct}
              onChange={n => set('filter', { ...cfg.filter, maxBondingCurvePct: n })}/>
            <Num l="Min age (min)" v={cfg.filter.minAgeMinutes}
              onChange={n => set('filter', { ...cfg.filter, minAgeMinutes: n })}/>
            <Num l="Max risk score" v={cfg.filter.maxRiskScore}
              onChange={n => set('filter', { ...cfg.filter, maxRiskScore: n })}/>
            <Num l="Min total score" v={cfg.filter.minTotalScore} step={0.05}
              onChange={n => set('filter', { ...cfg.filter, minTotalScore: n })}/>
            <div className="mt-2 pt-2 border-t border-white/[0.04]">
              <p className="text-[10px] text-[#6B7280] mb-1">
                Unconditional vetoes — no score overrides these.
              </p>
              <Num l="Veto: creator holds %" v={cfg.filter.vetoCreatorPct}
                onChange={n => set('filter', { ...cfg.filter, vetoCreatorPct: n })}/>
              <Num l="Veto: top-5 hold %" v={cfg.filter.vetoTop5Pct}
                onChange={n => set('filter', { ...cfg.filter, vetoTop5Pct: n })}/>
            </div>
          </div>
        )}

        {section === 'scoring' && (
          <div className={`${card} p-3`}>
            <p className={`${label} mb-2`}>Scoring weights</p>
            <p className="text-[10px] text-[#6B7280] mb-2 leading-snug">
              Normalised, so any scale works — 0.5/0.5/0.5/0.5 keeps the proportions and the
              result stays in 0–1.
            </p>
            <Num l="Audit" v={cfg.scoring.auditWeight} step={0.05}
              onChange={n => set('scoring', { ...cfg.scoring, auditWeight: n })}/>
            <Num l="Narrative" v={cfg.scoring.narrativeWeight} step={0.05}
              onChange={n => set('scoring', { ...cfg.scoring, narrativeWeight: n })}/>
            <Num l="Timing" v={cfg.scoring.timingWeight} step={0.05}
              onChange={n => set('scoring', { ...cfg.scoring, timingWeight: n })}/>
            <Num l="Metrics" v={cfg.scoring.metricsWeight} step={0.05}
              onChange={n => set('scoring', { ...cfg.scoring, metricsWeight: n })}/>
            <Num l="Timing cache (s)" v={cfg.scoring.timingCacheSeconds} step={60}
              onChange={n => set('scoring', { ...cfg.scoring, timingCacheSeconds: n })}/>
          </div>
        )}

        {section === 'risk' && (
          <div className={`${card} p-3`}>
            <p className={`${label} mb-2`}>Five limits, four exits</p>
            <Num l="Max SOL per trade" v={cfg.risk.maxSolPerTrade} step={0.01}
              onChange={n => set('risk', { ...cfg.risk, maxSolPerTrade: n })}/>
            <Num l="Daily loss limit (SOL)" v={cfg.risk.dailyLossLimitSol} step={0.1}
              onChange={n => set('risk', { ...cfg.risk, dailyLossLimitSol: n })}/>
            <Num l="Max trades / day" v={cfg.risk.maxDailyTrades}
              onChange={n => set('risk', { ...cfg.risk, maxDailyTrades: n })}/>
            <Num l="Max open positions" v={cfg.risk.maxOpenPositions}
              onChange={n => set('risk', { ...cfg.risk, maxOpenPositions: n })}/>
            <div className="mt-2 pt-2 border-t border-white/[0.04]">
              <Num l="Stop loss %" v={cfg.risk.stopLossPct}
                onChange={n => set('risk', { ...cfg.risk, stopLossPct: n })} hint="0 disables"/>
              <Num l="Take profit %" v={cfg.risk.takeProfitPct}
                onChange={n => set('risk', { ...cfg.risk, takeProfitPct: n })} hint="0 disables"/>
              <Num l="Trailing stop %" v={cfg.risk.trailingStopPct}
                onChange={n => set('risk', { ...cfg.risk, trailingStopPct: n })} hint="0 disables"/>
              <Num l="Max hold (s)" v={cfg.risk.maxHoldSeconds} step={60}
                onChange={n => set('risk', { ...cfg.risk, maxHoldSeconds: n })}/>
            </div>
            <p className="mt-2 text-[10px] text-[#6B7280] leading-snug">
              Position size is proportional to score, capped by the ceiling and by 30% of what
              is left of the daily loss budget — bets shrink as the day goes against you.
            </p>
          </div>
        )}

        {section === 'agents' && (
          <div className={`${card} p-3`}>
            <p className={`${label} mb-2`}>Grok agents</p>
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[11px] text-[#A7B0B7]">Fast model</span>
              <input value={cfg.grok.fastModel}
                onChange={e => set('grok', { ...cfg.grok, fastModel: e.target.value })}
                className={`${input} w-32`}/>
            </label>
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[11px] text-[#A7B0B7]">Checker model</span>
              <input value={cfg.grok.checkerModel}
                onChange={e => set('grok', { ...cfg.grok, checkerModel: e.target.value })}
                className={`${input} w-32`}/>
            </label>
            <Num l="Calls / minute" v={cfg.ops.maxCallsPerMinute}
              onChange={n => set('ops', { ...cfg.ops, maxCallsPerMinute: n })}/>
            <Num l="Daily call budget" v={cfg.ops.dailyCallBudget} step={100}
              onChange={n => set('ops', { ...cfg.ops, dailyCallBudget: n })}/>
            <Num l="Breaker after N failures" v={cfg.ops.breakerFailures}
              onChange={n => set('ops', { ...cfg.ops, breakerFailures: n })}/>
            <p className="mt-2 text-[10px] text-[#6B7280] leading-snug">
              Any agent failure returns the most pessimistic result, never a neutral one. A
              broken check is a refusal, never a silent skip.
            </p>
            <p className="mt-1 text-[10px] text-amber-400 leading-snug">
              Use your own xAI API key. Their acceptable use policy forbids automated access to
              consumer Grok and restricts financial advice — agent output is shown to you as
              risk information, not acted on as a recommendation.
            </p>
          </div>
        )}
      </div>

      {/* live confirmation */}
      {showLiveDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0D1117] p-5 space-y-3 max-h-[85vh] overflow-y-auto">
            <h3 className="text-sm font-black text-red-400">{LIVE_RISK_DISCLOSURE.title}</h3>
            <div className="space-y-1.5">
              {LIVE_RISK_DISCLOSURE.facts.map((f, i) => (
                <p key={i} className="text-[11px] text-[#A7B0B7] leading-snug">· {f}</p>
              ))}
            </div>
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <p className="text-[10px] text-red-400 leading-snug">
                {LIVE_RISK_DISCLOSURE.fromRepo}
              </p>
            </div>
            {!gate.ok && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2">
                <p className="text-[10px] text-amber-400 font-bold mb-1">Not ready:</p>
                {gate.blockers.map((b, i) => (
                  <p key={i} className="text-[10px] text-amber-400/90 leading-snug">· {b}</p>
                ))}
              </div>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}
                className="accent-red-400 mt-0.5"/>
              <span className="text-[11px] text-[#A7B0B7] leading-snug">
                {LIVE_RISK_DISCLOSURE.ack}
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setShowLiveDialog(false); setAck(false); }}
                className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">
                Stay in mock
              </button>
              <button disabled={!gate.ok || !ack}
                onClick={() => { set('mode', 'live'); setShowLiveDialog(false); }}
                className="flex-1 py-2.5 rounded-xl border border-red-500/40 bg-red-500/15 text-xs font-black text-red-400 disabled:opacity-30">
                Enable live
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
