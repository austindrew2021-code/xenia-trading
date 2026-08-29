import { useCallback, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts';
import { Features, testCausality } from '../engine/features';
import {
  CONFIRMS, CONTEXTS, FAMILIES, TRIGGERS, describeSpec, enumerateSpecs, mutateSpec,
} from '../engine/strategy';
import {
  backtest, nullTest, requiredPf, shuffleTest, walkForward,
} from '../engine/backtest';
import { atrPctEstimate, fetchHistory, leverageGeometry, Source } from '../engine/market';
import {
  BacktestResult, Candle, DEFAULT_RUN, FamilyName, RunConfig, StrategySpec,
  TF_HOURS, WalkForwardResult, liqDistance, roundTripCostEquity,
} from '../engine/types';

// ── Xenia palette ──────────────────────────────────────────────────────────
const CY = '#2BFFF1';
const cardCls = 'rounded-2xl border border-white/[0.05] bg-[#0D1117]/60';
const labelCls = 'text-[10px] uppercase tracking-widest text-[#4B5563]';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const c = tone === 'good' ? 'text-green-400' : tone === 'bad' ? 'text-red-400'
    : tone === 'warn' ? 'text-amber-400' : 'text-[#F4F6FA]';
  return (
    <div className="px-3 py-2">
      <p className={labelCls}>{label}</p>
      <p className={`text-sm font-bold ${c}`}>{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, step = 1, min, max }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-[#A7B0B7]">{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-24 bg-[#0D1117] border border-white/[0.07] rounded-lg px-2 py-1
                   text-xs text-[#F4F6FA] text-right focus:border-[#2BFFF1]/40 outline-none"
      />
    </label>
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-[#A7B0B7]">{label}</span>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-40 bg-[#0D1117] border border-white/[0.07] rounded-lg px-2 py-1
                   text-xs text-[#F4F6FA] focus:border-[#2BFFF1]/40 outline-none"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

const INTERVALS = ['15m', '1h', '4h', '12h', '1d'];

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('4h');
  const [source, setSource] = useState<Source>('binance');
  const [bars, setBars] = useState(3000);

  const [leverage, setLeverage] = useState(10);
  const [marginFraction, setMarginFraction] = useState(0.5);
  const [startEquity, setStartEquity] = useState(50);
  const [slippage, setSlippage] = useState(0.05);
  const [beOn, setBeOn] = useState(true);

  const [family, setFamily] = useState<FamilyName>('sweep_reclaim');
  const [trigger, setTrigger] = useState('sweep_low');
  const [context, setContext] = useState('in_discount');
  const [confirm, setConfirm] = useState('close_above_open');
  const [stopKind, setStopKind] = useState('bar');
  const [rr, setRr] = useState(2);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [wf, setWf] = useState<WalkForwardResult | null>(null);
  const [integrity, setIntegrity] = useState<string[]>([]);
  const [searchLog, setSearchLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const cfg: RunConfig = useMemo(() => ({
    ...DEFAULT_RUN,
    leverage, marginFraction, startEquity,
    costs: { ...DEFAULT_RUN.costs, slippagePctPerSide: slippage },
    beAtR: beOn ? 1.0 : null,
    trailAtr: null,
    tfHours: TF_HOURS[interval] ?? 4,
  }), [leverage, marginFraction, startEquity, slippage, beOn, interval]);

  const spec: StrategySpec = useMemo(() => ({
    family, trigger,
    context: context === 'any' ? [] : [context],
    confirm,
    stop: stopKind === 'atr' ? { kind: 'atr', mult: 1.5 }
      : stopKind === 'swing' ? { kind: 'swing', padAtr: 0.3 }
        : { kind: 'bar', padAtr: 0.25 },
    exit: { kind: 'rr', rr },
    params: { minSweepDepthAtr: 0.15, minPocDist: 1, maxHoldBars: 24 },
  }), [family, trigger, context, confirm, stopKind, rr]);

  const features = useMemo(
    () => (candles.length > 200 ? new Features(candles, { tfHours: cfg.tfHours }) : null),
    [candles, cfg.tfHours],
  );

  const geometry = useMemo(() => {
    if (!candles.length) return null;
    return leverageGeometry(atrPctEstimate(candles), leverage);
  }, [candles, leverage]);

  const costPerTrade = roundTripCostEquity(cfg) * 100;
  const costAsR = useMemo(() => {
    if (!geometry || !geometry.atrPct) return 0;
    const riskPct = 1.2 * geometry.atrPct * leverage * marginFraction / 100;
    return riskPct > 0 ? (roundTripCostEquity(cfg)) / riskPct : 0;
  }, [geometry, cfg, leverage, marginFraction]);

  const load = useCallback(async () => {
    setBusy('Loading history…');
    setResult(null); setWf(null);
    const h = await fetchHistory({ symbol, interval, bars, source });
    setCandles(h.candles);
    setWarnings(h.warnings);
    setBusy(null);
  }, [symbol, interval, bars, source]);

  const runBacktest = useCallback(() => {
    if (!features) return;
    setBusy('Backtesting…');
    setTimeout(() => {
      setResult(backtest(spec, features, cfg));
      setBusy(null);
    }, 10);
  }, [features, spec, cfg]);

  const runWalkForward = useCallback(() => {
    if (!features) return;
    setBusy('Walk-forward…');
    setTimeout(() => {
      setWf(walkForward(spec, features, cfg, symbol, 1));
      setBusy(null);
    }, 10);
  }, [features, spec, cfg, symbol]);

  const runIntegrity = useCallback(() => {
    setBusy('Integrity tests…');
    setTimeout(() => {
      const out: string[] = [];
      if (candles.length > 400) {
        const c = testCausality(candles, 20);
        out.push(c.ok
          ? `Causality: PASS — ${c.featuresChecked} features, ${c.probes} probes, no lookahead`
          : `Causality: FAIL — ${Object.keys(c.violations).join(', ')} can see the future`);
      }
      const specs: StrategySpec[] = [];
      for (const fam of Object.keys(FAMILIES) as FamilyName[]) {
        specs.push(...enumerateSpecs(fam, 3).slice(0, 10));
      }
      const nt = nullTest(specs, cfg, 3000);
      out.push(nt.ok
        ? `Null test: PASS — ${nt.n} specs on a random walk average ${(nt.mean * 100).toFixed(2)}% `
        + `per trade (expected ~${(nt.expected * 100).toFixed(2)}%, i.e. minus the cost)`
        : `Null test: FAIL — engine produces positive edge on pure noise. Do not trust any result.`);
      if (features && candles.length > 400) {
        const sh = shuffleTest(spec, candles, cfg);
        out.push(`Shuffle test: real ${(sh.real * 100).toFixed(2)}% vs shuffled `
          + `${(sh.shuffled * 100).toFixed(2)}% per trade — `
          + `${sh.real > sh.shuffled + 0.005 ? 'edge depends on bar order (good sign)'
            : 'edge survives shuffling, so it is a sizing artefact not a pattern'}`);
      }
      setIntegrity(out);
      setBusy(null);
    }, 10);
  }, [candles, cfg, spec, features]);

  /**
   * Search the family with a rising promotion bar. Each spec tested raises the
   * profit factor a winner must clear, because the more you search the more
   * likely the best result is luck. See requiredPf().
   */
  const runSearch = useCallback(() => {
    if (!features) return;
    setBusy('Searching family…');
    setTimeout(() => {
      const queue = enumerateSpecs(family, 7).slice(0, 60);
      const log: string[] = [];
      const promising: StrategySpec[] = [];
      let best: WalkForwardResult | null = null;
      let bestSpec: StrategySpec | null = null;
      let s = 42;
      const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

      for (let trial = 0; trial < queue.length; trial++) {
        const cand = promising.length && rand() < 0.3
          ? mutateSpec(promising[promising.length - 1], rand)
          : queue[trial];
        const r = walkForward(cand, features, cfg, symbol, trial + 1);
        if (!r) continue;
        if (r.oosPfPooled > 1.05) promising.push(cand);
        if (!best || r.oosExpectancy > best.oosExpectancy) { best = r; bestSpec = cand; }
        if (r.passed) {
          log.push(`SURVIVOR @ trial ${trial + 1}: OOS pf ${r.oosPfPooled.toFixed(2)} `
            + `(needed ${r.requiredPf.toFixed(2)}), n=${r.oosN}, `
            + `${r.foldsPositive}/${r.folds.length} folds positive — ${describeSpec(cand)}`);
        }
      }
      if (!log.length) {
        log.push(`NO EDGE FOUND in "${family}" after ${queue.length} trials.`);
        if (best && bestSpec) {
          log.push(`Best attempt: OOS pf ${best.oosPfPooled.toFixed(2)} vs required `
            + `${best.requiredPf.toFixed(2)}, IS-OOS gap ${best.overfitGap.toFixed(2)} — ${describeSpec(bestSpec)}`);
          const reg = Object.entries(best.byRegime)
            .map(([k, v]) => `${k} ${(v.expectancy * 100).toFixed(2)}% (n=${v.n})`).join(', ');
          if (reg) log.push(`Best attempt by regime: ${reg} — a setup that is positive in one `
            + `regime and negative in another needs a filter, not a new pattern.`);
        }
        log.push(`This is a legitimate answer. Mark the family exhausted and pivot to another.`);
      }
      setSearchLog(log);
      setBusy(null);
    }, 10);
  }, [features, family, cfg, symbol]);

  const equityData = useMemo(
    () => (result?.equityCurve ?? []).map(p => ({
      t: new Date(p.time).toISOString().slice(0, 10), equity: +p.equity.toFixed(2),
    })),
    [result],
  );

  const triggerOpts = FAMILIES[family].map(t => [t, TRIGGERS[t]?.label ?? t] as [string, string]);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#080B10] text-[#F4F6FA]">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black tracking-tight">Research Lab</h1>
          <p className="text-[10px] text-[#4B5563]">
            Walk-forward tested. Costs, liquidation and slippage included. No lookahead.
          </p>
        </div>
        {busy && <span className="text-[10px] text-[#2BFFF1] animate-pulse">{busy}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 px-4 pb-6">
        {/* ── Controls ── */}
        <div className="space-y-3">
          <div className={`${cardCls} p-3`}>
            <p className={`${labelCls} mb-2`}>Market</p>
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[11px] text-[#A7B0B7]">Symbol</span>
              <input
                value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                className="w-32 bg-[#0D1117] border border-white/[0.07] rounded-lg px-2 py-1
                           text-xs text-right focus:border-[#2BFFF1]/40 outline-none"
              />
            </label>
            <Select label="Source" value={source}
              options={[['binance', 'Binance'], ['kucoin', 'KuCoin'], ['gecko', 'Solana DEX']]}
              onChange={v => setSource(v as Source)} />
            <Select label="Timeframe" value={interval}
              options={INTERVALS.map(i => [i, i] as [string, string])}
              onChange={setInterval} />
            <Field label="Bars" value={bars} step={500} min={500} onChange={setBars} />
            <button onClick={load}
              className="mt-2 w-full py-2 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/30
                         text-[#2BFFF1] text-xs font-bold hover:bg-[#2BFFF1]/20">
              Load history
            </button>
            {candles.length > 0 && (
              <p className="mt-2 text-[10px] text-[#6B7280]">
                {candles.length} bars · {new Date(candles[0].time).toISOString().slice(0, 10)}
                {' → '}{new Date(candles[candles.length - 1].time).toISOString().slice(0, 10)}
              </p>
            )}
            {warnings.map((w, i) => (
              <p key={i} className="mt-1 text-[10px] text-amber-400 leading-snug">⚠ {w}</p>
            ))}
          </div>

          <div className={`${cardCls} p-3`}>
            <p className={`${labelCls} mb-2`}>Risk &amp; sizing</p>
            <Field label="Leverage" value={leverage} min={1} max={50} onChange={setLeverage} />
            <Field label="Margin fraction" value={marginFraction} step={0.05} min={0.05} max={1}
              onChange={setMarginFraction} />
            <Field label="Start equity ($)" value={startEquity} step={10} onChange={setStartEquity} />
            <Field label="Slippage % / side" value={slippage} step={0.01} onChange={setSlippage} />
            <label className="flex items-center justify-between py-1">
              <span className="text-[11px] text-[#A7B0B7]">Break-even at 1R</span>
              <input type="checkbox" checked={beOn} onChange={e => setBeOn(e.target.checked)}
                className="accent-[#2BFFF1]" />
            </label>

            <div className="mt-2 rounded-xl bg-[#0D1117] border border-white/[0.05] p-2 space-y-1">
              <p className="text-[10px] text-[#6B7280]">
                Round trip costs <span className="text-[#F4F6FA] font-bold">{costPerTrade.toFixed(2)}%</span> of
                equity per trade
                {costAsR > 0 && <> — that is <span className={costAsR > 0.3 ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                  {costAsR.toFixed(2)}R</span> against a 1.2 ATR stop</>}
              </p>
              {costAsR > 0.3 && (
                <p className="text-[10px] text-red-400 leading-snug">
                  You start every trade down {costAsR.toFixed(2)} risk units. No pattern quality
                  overcomes this — go to a slower timeframe.
                </p>
              )}
              {geometry && (
                <p className={`text-[10px] leading-snug ${geometry.usable ? 'text-[#6B7280]' : 'text-red-400'}`}>
                  {geometry.note}
                </p>
              )}
              <p className="text-[10px] text-[#4B5563]">
                Liquidation at {(liqDistance(leverage) * 100).toFixed(2)}% adverse move.
              </p>
            </div>
          </div>

          <div className={`${cardCls} p-3`}>
            <p className={`${labelCls} mb-2`}>Strategy</p>
            <Select label="Family" value={family}
              options={(Object.keys(FAMILIES) as FamilyName[]).map(f => [f, f.replace('_', ' ')])}
              onChange={v => {
                const fam = v as FamilyName;
                setFamily(fam);
                setTrigger(FAMILIES[fam][0]);
              }} />
            <Select label="Trigger" value={trigger} options={triggerOpts} onChange={setTrigger} />
            <Select label="Context" value={context}
              options={[['any', 'Any'], ...Object.entries(CONTEXTS).map(([k, v]) => [k, v.label] as [string, string])]}
              onChange={setContext} />
            <Select label="Confirmation" value={confirm}
              options={Object.entries(CONFIRMS).map(([k, v]) => [k, v.label] as [string, string])}
              onChange={setConfirm} />
            <Select label="Stop" value={stopKind}
              options={[['bar', 'Beyond bar extreme'], ['swing', 'Beyond swing'], ['atr', 'ATR multiple']]}
              onChange={setStopKind} />
            <Field label="Reward : risk" value={rr} step={0.5} min={0.8} onChange={setRr} />
            <p className="mt-2 text-[10px] text-[#6B7280] leading-snug">{describeSpec(spec)}</p>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={runBacktest} disabled={!features}
                className="py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs
                           font-bold disabled:opacity-30 hover:bg-white/[0.08]">Backtest</button>
              <button onClick={runWalkForward} disabled={!features}
                className="py-2 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/30 text-[#2BFFF1]
                           text-xs font-bold disabled:opacity-30 hover:bg-[#2BFFF1]/20">Walk-forward</button>
              <button onClick={runSearch} disabled={!features}
                className="py-2 rounded-xl bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#A78BFA]
                           text-xs font-bold disabled:opacity-30 hover:bg-[#A78BFA]/20">Search family</button>
              <button onClick={runIntegrity}
                className="py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs
                           font-bold hover:bg-white/[0.08]">Integrity</button>
            </div>
          </div>
        </div>

        {/* ── Results ── */}
        <div className="lg:col-span-2 space-y-3">
          {result && (
            <div className={cardCls}>
              <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-white/[0.04]">
                <Stat label="Trades" value={String(result.stats.n)}
                  tone={result.stats.n < 30 ? 'warn' : undefined} />
                <Stat label="Profit factor" value={result.stats.pf.toFixed(2)}
                  tone={result.stats.pf >= 1.3 ? 'good' : result.stats.pf < 1 ? 'bad' : undefined} />
                <Stat label="Expectancy" value={`${(result.stats.expectancy * 100).toFixed(2)}%`}
                  tone={result.stats.expectancy > 0 ? 'good' : 'bad'} />
                <Stat label="Win rate" value={`${result.stats.winRate.toFixed(0)}%`} />
                <Stat label="Max DD" value={`${result.stats.maxDrawdownPct.toFixed(0)}%`}
                  tone={result.stats.maxDrawdownPct > 50 ? 'bad' : undefined} />
                <Stat label="Final" value={`$${result.finalEquity.toFixed(0)}`}
                  tone={result.finalEquity > startEquity ? 'good' : 'bad'} />
              </div>

              {result.stats.n < 30 && (
                <p className="px-3 pb-2 text-[10px] text-amber-400">
                  Fewer than 30 trades tells you almost nothing. A profit factor of 3 on 12 trades
                  is not better than 1.4 on 200 — it is less measured.
                </p>
              )}
              {result.stats.skippedStopOutsideLiq > 0 && (
                <p className="px-3 pb-2 text-[10px] text-amber-400">
                  {result.stats.skippedStopOutsideLiq} signals skipped — the stop sat outside the
                  liquidation distance at {leverage}×, so it would not have existed.
                </p>
              )}

              {equityData.length > 1 && (
                <div className="h-48 px-2 pb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityData}>
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#4B5563' }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 9, fill: '#4B5563' }} width={44} />
                      <Tooltip contentStyle={{ background: '#0D1117', border: '1px solid #1F2937', fontSize: 11 }} />
                      <ReferenceLine y={startEquity} stroke="#374151" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="equity" stroke={CY} dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="px-3 pb-3 flex flex-wrap gap-2">
                {Object.entries(result.stats.byRegime).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-2 py-1 rounded-lg border border-white/[0.06]">
                    <span className="text-[#6B7280]">{k}</span>{' '}
                    <span className={v.expectancy > 0 ? 'text-green-400' : 'text-red-400'}>
                      {(v.expectancy * 100).toFixed(2)}%
                    </span>
                    <span className="text-[#374151]"> n={v.n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {wf && (
            <div className={`${cardCls} p-3`}>
              <div className="flex items-center justify-between mb-2">
                <p className={labelCls}>Walk-forward (purged)</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                  wf.passed ? 'text-green-400 border-green-400/30 bg-green-400/10'
                    : 'text-red-400 border-red-400/30 bg-red-400/10'}`}>
                  {wf.passed ? 'SURVIVOR' : 'REJECTED'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div><span className="text-[#4B5563]">OOS pf</span>{' '}
                  <span className="font-bold">{wf.oosPfPooled.toFixed(2)}</span></div>
                <div><span className="text-[#4B5563]">Required</span>{' '}
                  <span className="font-bold">{wf.requiredPf.toFixed(2)}</span></div>
                <div><span className="text-[#4B5563]">OOS trades</span>{' '}
                  <span className="font-bold">{wf.oosN}</span></div>
                <div><span className="text-[#4B5563]">Folds +</span>{' '}
                  <span className="font-bold">{wf.foldsPositive}/{wf.folds.length}</span></div>
              </div>
              <p className="mt-2 text-[10px] text-[#6B7280] leading-snug">
                In-sample pf {wf.isPfMean.toFixed(2)} vs out-of-sample {wf.oosPfPooled.toFixed(2)} —
                a gap of {wf.overfitGap.toFixed(2)}. That gap is the overfitting, measured.
              </p>
              <div className="mt-2 space-y-1">
                {wf.folds.map(f => (
                  <div key={f.fold} className="flex items-center gap-2 text-[10px]">
                    <span className="text-[#4B5563] w-10">Fold {f.fold}</span>
                    <span className="text-[#6B7280]">IS {f.isPf.toFixed(2)}</span>
                    <span className={f.oosExpectancy > 0 ? 'text-green-400' : 'text-red-400'}>
                      OOS {f.oosPf.toFixed(2)} ({f.oosN} trades)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchLog.length > 0 && (
            <div className={`${cardCls} p-3`}>
              <p className={`${labelCls} mb-2`}>Family search</p>
              {searchLog.map((l, i) => (
                <p key={i} className={`text-[10px] leading-relaxed mb-1 ${
                  l.startsWith('SURVIVOR') ? 'text-green-400'
                    : l.startsWith('NO EDGE') ? 'text-amber-400' : 'text-[#6B7280]'}`}>{l}</p>
              ))}
            </div>
          )}

          {integrity.length > 0 && (
            <div className={`${cardCls} p-3`}>
              <p className={`${labelCls} mb-2`}>Engine integrity</p>
              {integrity.map((l, i) => (
                <p key={i} className={`text-[10px] leading-relaxed mb-1 ${
                  l.includes('FAIL') ? 'text-red-400' : 'text-[#6B7280]'}`}>{l}</p>
              ))}
            </div>
          )}

          <div className={`${cardCls} p-3`}>
            <p className={`${labelCls} mb-2`}>Promotion bar</p>
            <p className="text-[10px] text-[#6B7280] leading-relaxed mb-2">
              The out-of-sample profit factor needed to be 95% confident a result is not simply the
              luckiest of N candidates. Every backtest you run raises this bar. A fixed threshold
              like &quot;pf &gt; 1.3&quot; is cleared by roughly 100% of pure noise at small trade counts.
            </p>
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="text-[#4B5563]">
                    <th className="text-left py-1">OOS trades</th>
                    {[1, 10, 50, 200, 1000].map(n => <th key={n} className="text-right px-2">N={n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[30, 50, 100, 200].map(n => (
                    <tr key={n} className="border-t border-white/[0.04]">
                      <td className="py-1 text-[#A7B0B7]">{n}</td>
                      {[1, 10, 50, 200, 1000].map(N => (
                        <td key={N} className="text-right px-2 text-[#F4F6FA]">
                          {requiredPf(n, N).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
