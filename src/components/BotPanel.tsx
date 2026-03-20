import { useTradingStore } from '../store';
import { Bot1Config, Bot2Config, Bot3Config, Bot4Config } from '../types';
import { useState } from 'react';

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-[#2BFFF1]' : 'bg-[#1a2030]'}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function Field({ label, value, onChange, step = 0.01, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-[#6B7280] flex-1">{label}</span>
      <input type="number" value={value} step={step} min={min}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-[#F4F6FA] text-right outline-none focus:border-[#2BFFF1]/40" />

      {/* ── Bot 4: IFVG ── */}
    </div>
  );
}

function IndicatorToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border ${on ? 'bg-[#2BFFF1]/15 border-[#2BFFF1]/40 text-[#2BFFF1]' : 'bg-transparent border-white/[0.08] text-[#4B5563]'}`}>
      {label}
    </button>
  );
}

function BotCard({ id, title, desc, badge, active, color, children }: {
  id: string; title: string; desc: string; badge: string;
  active: boolean; color: string; children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-2xl border transition-all ${active ? `border-[${color}]/30 bg-[${color}]/5` : 'border-white/[0.07] bg-white/[0.02]'}`}
      style={{ borderColor: active ? color + '44' : undefined, background: active ? color + '08' : undefined }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-[#F4F6FA]">{title}</span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: color + '20', color, border: `1px solid ${color}40` }}>{badge}</span>
              {active && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />}
            </div>
            <p className="text-[11px] text-[#6B7280] leading-snug">{desc}</p>
          </div>
          {children && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-[#4B5563] hover:text-[#2BFFF1] text-lg transition-colors flex-shrink-0 mt-0.5">
              {expanded ? '−' : '+'}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.05] pt-3">
          {children}
        </div>
      )}

      {/* ── Bot 4: IFVG ── */}
    </div>
  );
}

export function BotPanel() {
  const { botConfigs, updateBotConfig } = useTradingStore();
  const { bot1, bot2, bot3, bot4 } = botConfigs;

  const upd1 = (p: Partial<Bot1Config>) => updateBotConfig('bot1', p);
  const upd2 = (p: Partial<Bot2Config>) => updateBotConfig('bot2', p);
  const upd3 = (p: Partial<Bot3Config>) => updateBotConfig('bot3', p);
  const upd4 = (p: Partial<Bot4Config>) => updateBotConfig('bot4', p);

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Bot Control</span>
        <span className="text-[10px] text-[#4B5563]">15s cycle</span>
      </div>

      {/* ── Bot 1 ── */}
      <BotCard id="bot1" title="Bot 1 — Momentum" desc="RSI + Stochastic crossover with hidden divergence confirmation"
        badge="V1" active={bot1.enabled} color="#2BFFF1">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A7B0B7] font-semibold">Enable Bot 1</span>
            <Toggle on={bot1.enabled} onChange={v => upd1({ enabled: v })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Indicators</p>
            <div className="flex flex-wrap gap-1.5">
              <IndicatorToggle label="RSI" on={bot1.useRSI} onChange={v => upd1({ useRSI: v })} />
              <IndicatorToggle label="Stoch" on={bot1.useStoch} onChange={v => upd1({ useStoch: v })} />
              <IndicatorToggle label="Momentum" on={bot1.useMomentum} onChange={v => upd1({ useMomentum: v })} />
              <IndicatorToggle label="Divergence" on={bot1.useDivergence} onChange={v => upd1({ useDivergence: v })} />
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide">Parameters</p>
            <Field label="Lookback (candles)" value={bot1.lookback ?? 50} step={10} min={10} onChange={v => upd1({ lookback: v })} />
            <Field label="Base Size ($)" value={bot1.betSize} step={5} onChange={v => upd1({ betSize: v })} />
            <Field label="Conf Scale ($)" value={bot1.sizeScaleExtra} step={1} onChange={v => upd1({ sizeScaleExtra: v })} />
            <Field label="Max Size ($)" value={bot1.maxSize} step={10} onChange={v => upd1({ maxSize: v })} />
            <Field label="Leverage" value={bot1.leverage} step={1} min={1} onChange={v => upd1({ leverage: v })} />
            <Field label="RSI Oversold" value={bot1.rsiOversold} step={1} onChange={v => upd1({ rsiOversold: v })} />
            <Field label="RSI Overbought" value={bot1.rsiOverbought} step={1} onChange={v => upd1({ rsiOverbought: v })} />
            <Field label="Stoch Oversold" value={bot1.stochOversold} step={1} onChange={v => upd1({ stochOversold: v })} />
            <Field label="Stoch Overbought" value={bot1.stochOverbought} step={1} onChange={v => upd1({ stochOverbought: v })} />
          </div>
        </div>
      </BotCard>

      {/* ── Bot 2 ── */}
      <BotCard id="bot2" title="Bot 2 — Kelly + ATR" desc="Kelly position sizing, ATR trailing stop, partial exits, momentum chain"
        badge="V2" active={bot2.enabled} color="#A78BFA">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A7B0B7] font-semibold">Enable Bot 2</span>
            <Toggle on={bot2.enabled} onChange={v => upd2({ enabled: v })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Indicators & Features</p>
            <div className="flex flex-wrap gap-1.5">
              <IndicatorToggle label="RSI" on={bot2.useRSI} onChange={v => upd2({ useRSI: v })} />
              <IndicatorToggle label="Stoch" on={bot2.useStoch} onChange={v => upd2({ useStoch: v })} />
              <IndicatorToggle label="Momentum" on={bot2.useMomentum} onChange={v => upd2({ useMomentum: v })} />
              <IndicatorToggle label="Divergence" on={bot2.useDivergence} onChange={v => upd2({ useDivergence: v })} />
              <IndicatorToggle label="ATR Filter" on={bot2.useATR} onChange={v => upd2({ useATR: v })} />
              <IndicatorToggle label="Kelly Size" on={bot2.useKelly} onChange={v => upd2({ useKelly: v })} />
              <IndicatorToggle label="Trail Stop" on={bot2.useTrailingStop} onChange={v => upd2({ useTrailingStop: v })} />
              <IndicatorToggle label="Partial Exit" on={bot2.usePartialExit} onChange={v => upd2({ usePartialExit: v })} />
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide">Parameters</p>
            <Field label="Lookback (candles)" value={bot2.lookback ?? 80} step={10} min={10} onChange={v => upd2({ lookback: v })} />
            <Field label="Base Size ($)" value={bot2.betSize} step={5} onChange={v => upd2({ betSize: v })} />
            <Field label="Max Size ($)" value={bot2.maxSize} step={10} onChange={v => upd2({ maxSize: v })} />
            <Field label="Leverage" value={bot2.leverage} step={1} min={1} onChange={v => upd2({ leverage: v })} />
            <Field label="Min Confidence" value={bot2.minConf} step={0.5} onChange={v => upd2({ minConf: v })} />
            <Field label="Min ATR %" value={bot2.minAtrPct} step={0.01} onChange={v => upd2({ minAtrPct: v })} />
            <Field label="Max ATR %" value={bot2.maxAtrPct} step={0.1} onChange={v => upd2({ maxAtrPct: v })} />
            <Field label="Partial Exit %" value={bot2.partialExitAtGain} step={0.05} onChange={v => upd2({ partialExitAtGain: v })} />
            <Field label="Hard Stop %" value={bot2.hardStopLossPct} step={0.01} onChange={v => upd2({ hardStopLossPct: v })} />
            <Field label="ATR Trail ×" value={bot2.atrTrailMultiplier} step={0.1} onChange={v => upd2({ atrTrailMultiplier: v })} />
            <Field label="Win Prob (Kelly)" value={bot2.expectedWinProb} step={0.01} onChange={v => upd2({ expectedWinProb: v })} />
          </div>
        </div>
      </BotCard>

      {/* ── Bot 3 ── */}
      <BotCard id="bot3" title="Bot 3 — Beast Scalper" desc="v17 aggressive scalper: EMA trend, candle patterns, 8 TP tiers, reversal detection"
        badge="V17" active={bot3.enabled} color="#F59E0B">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A7B0B7] font-semibold">Enable Bot 3</span>
            <Toggle on={bot3.enabled} onChange={v => upd3({ enabled: v })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Indicators & Features</p>
            <div className="flex flex-wrap gap-1.5">
              <IndicatorToggle label="RSI" on={bot3.useRSI} onChange={v => upd3({ useRSI: v })} />
              <IndicatorToggle label="Stoch" on={bot3.useStoch} onChange={v => upd3({ useStoch: v })} />
              <IndicatorToggle label="EMA 18/45" on={bot3.useEMA} onChange={v => upd3({ useEMA: v })} />
              <IndicatorToggle label="Candle Patterns" on={bot3.useCandlePatterns} onChange={v => upd3({ useCandlePatterns: v })} />
              <IndicatorToggle label="Momentum" on={bot3.useMomentum} onChange={v => upd3({ useMomentum: v })} />
              <IndicatorToggle label="Trail Stop" on={bot3.useTrailingStop} onChange={v => upd3({ useTrailingStop: v })} />
              <IndicatorToggle label="Multi-TP" on={bot3.useMultiTPTiers} onChange={v => upd3({ useMultiTPTiers: v })} />
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide">Parameters</p>
            <Field label="Lookback (candles)" value={bot3.lookback ?? 100} step={10} min={10} onChange={v => upd3({ lookback: v })} />
            <Field label="Base Size ($)" value={bot3.betSizeBase} step={0.5} onChange={v => upd3({ betSizeBase: v })} />
            <Field label="Max Size ($)" value={bot3.betSizeMax} step={5} onChange={v => upd3({ betSizeMax: v })} />
            <Field label="Leverage" value={bot3.leverage} step={1} min={1} onChange={v => upd3({ leverage: v })} />
            <Field label="Min Conf" value={bot3.minConf} step={0.1} onChange={v => upd3({ minConf: v })} />
            <Field label="Hard Stop %" value={bot3.hardStopLossPct} step={0.005} onChange={v => upd3({ hardStopLossPct: v })} />
            <Field label="Trail Activate %" value={bot3.trailActivateAt} step={0.01} onChange={v => upd3({ trailActivateAt: v })} />
            <Field label="Trail Drop %" value={bot3.trailDropPct} step={0.01} onChange={v => upd3({ trailDropPct: v })} />
          </div>
          <div className="space-y-1.5 pt-1">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide">TP Tiers (threshold / exit %)</p>
            {([
              ['TP 3%',  'tp03Pct', 'tp03Frac'],
              ['TP 5%',  'tp05Pct', 'tp05Frac'],
              ['TP 8%',  'tp08Pct', 'tp08Frac'],
              ['TP 12%', 'tp12Pct', 'tp12Frac'],
              ['TP 18%', 'tp18Pct', 'tp18Frac'],
              ['TP 25%', 'tp25Pct', 'tp25Frac'],
              ['TP 40%', 'tp40Pct', 'tp40Frac'],
              ['TP 60%', 'tp60Pct', 'tp60Frac'],
            ] as [string, keyof Bot3Config, keyof Bot3Config][]).map(([label, tPct, tFrac]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] text-[#6B7280] w-12">{label}</span>
                <input type="number" value={(bot3[tPct] as number)} step={0.01}
                  onChange={e => upd3({ [tPct]: parseFloat(e.target.value)||0 } as any)}
                  className="w-14 bg-[#0B0E14] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-[#F4F6FA] text-right outline-none" />
                <span className="text-[10px] text-[#4B5563]">→</span>
                <input type="number" value={(bot3[tFrac] as number)} step={0.05}
                  onChange={e => upd3({ [tFrac]: parseFloat(e.target.value)||0 } as any)}
                  className="w-14 bg-[#0B0E14] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-[#F4F6FA] text-right outline-none" />
              </div>
            ))}
          </div>
        </div>
      </BotCard>

      {/* ── Bot 4: IFVG ── */}
      <BotCard id="bot4" title="Bot 4 — IFVG Scalper" desc="ICT Inverse Fair Value Gap: detects FVG imbalances, waits for full inversion, enters on retest. Best on 1m–15m."
        badge="ICT" active={bot4?.enabled ?? false} color="#2BFFF1">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A7B0B7] font-semibold">Enable Bot 4</span>
            <Toggle on={bot4?.enabled ?? false} onChange={v => upd4({ enabled: v })} />
          </div>

          {/* Visual explanation */}
          <div className="rounded-xl bg-[#2BFFF1]/05 border border-[#2BFFF1]/15 p-3 space-y-1">
            <p className="text-[10px] text-[#2BFFF1] font-bold">How IFVG works:</p>
            <p className="text-[9px] text-[#6B7280] leading-relaxed">1. Detects 3-candle FVG imbalances (price moves too fast, leaves a gap)</p>
            <p className="text-[9px] text-[#6B7280] leading-relaxed">2. Waits for price to fully trade <em>through</em> the FVG (inversion)</p>
            <p className="text-[9px] text-[#6B7280] leading-relaxed">3. Enters when price <em>retests</em> the zone — bullish FVG flipped = resistance, bearish FVG flipped = support</p>
            <div className="flex gap-2 mt-1">
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">🔴 Bullish FVG → SHORT</span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">🟢 Bearish FVG → LONG</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Confirmations</p>
            <div className="flex flex-wrap gap-1.5">
              <IndicatorToggle label="Require BOS" on={bot4?.requireBOS ?? true} onChange={v => upd4({ requireBOS: v })} />
              <IndicatorToggle label="Vol Spike" on={bot4?.requireVolSpike ?? false} onChange={v => upd4({ requireVolSpike: v })} />
              <IndicatorToggle label="Zone SL/TP" on={bot4?.stopBeyondZone ?? true} onChange={v => upd4({ stopBeyondZone: v })} />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide">Parameters</p>
            <Field label="Lookback (candles)" value={bot4?.lookback ?? 80} step={10} min={20} onChange={v => upd4({ lookback: v })} />
            <Field label="Base Size ($)" value={bot4?.betSize ?? 15} step={5} onChange={v => upd4({ betSize: v })} />
            <Field label="Max Size ($)" value={bot4?.maxSize ?? 150} step={10} onChange={v => upd4({ maxSize: v })} />
            <Field label="Leverage" value={bot4?.leverage ?? 10} step={1} min={1} onChange={v => upd4({ leverage: v })} />
            <Field label="Min FVG Body %" value={bot4?.fvgMinBodyPct ?? 0.25} step={0.05} onChange={v => upd4({ fvgMinBodyPct: v })} />
            <Field label="Max FVG Age" value={bot4?.fvgMaxAge ?? 25} step={5} min={5} onChange={v => upd4({ fvgMaxAge: v })} />
            <Field label="Retest Tolerance" value={bot4?.retestTolerance ?? 0.4} step={0.05} onChange={v => upd4({ retestTolerance: v })} />
            <Field label="TP Multiple" value={bot4?.tpMultiple ?? 2.0} step={0.25} onChange={v => upd4({ tpMultiple: v })} />
            <Field label="Min Confidence" value={bot4?.edgeThreshold ?? 0.55} step={0.05} onChange={v => upd4({ edgeThreshold: v })} />
          </div>
        </div>
      </BotCard>
    </div>
  );
}
