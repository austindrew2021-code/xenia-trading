// ── Xenia — Bot config validation ─────────────────────────────────────────
//
// The AI bot builder is the feature that differentiates Xenia. It is also the
// feature with the widest gap between "saved successfully" and "actually works",
// because an LLM writing JSON will confidently invent an indicator id.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PROBLEM
//
// XeniaBot.tsx inserts whatever the model returned:
//
//     indicators: pendingBot.indicators ?? [],
//     entry_rules: pendingBot.entry_rules ?? { logic: 'AND' },
//
// with no check that any of it is real. If the model returns
// `{ id: 'rsi_divergence' }` or `{ id: 'ichimoku_cloud' }` — plausible names that
// are not in the registry — the insert succeeds, the bot appears in The Lab, the
// user deploys it, and it never fires. Nothing errors. The user concludes the
// feature is broken, and they are right, but not in a way anyone can debug.
//
// This is the same class of failure as the chart NaN bug: success at every step
// and nothing at the end.
//
// A validator here also makes the AI better, because rejected configs come back
// with the reason and the model can be re-prompted with the valid id list.
// ═══════════════════════════════════════════════════════════════════════════

import { IMPLEMENTED_IDS } from '../components/indicatorsExtended';

export const CANDLE_PATTERNS = [
  'Doji', 'Hammer', 'Shooting Star', 'Bullish Engulfing', 'Bearish Engulfing',
  'Morning Star', 'Evening Star', 'Bullish Pinbar', 'Bearish Pinbar', 'Inside Bar',
  'Three White Soldiers', 'Three Black Crows', 'Tweezer Tops', 'Tweezer Bottoms',
];

export interface BotIndicator { id: string; params: Record<string, number> }

export interface BotConfig {
  name: string;
  description: string;
  indicators: BotIndicator[];
  candle_patterns: string[];
  entry_rules: { logic?: 'AND' | 'OR'; conditions?: unknown[] };
  exit_rules: { mode?: string; tp_pct?: number; sl_pct?: number };
  risk_rules: { max_position_pct?: number; max_leverage?: number };
}

export interface ValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
  /** Applied automatically when repair is requested. */
  fix?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  repaired: BotConfig;
  /** Feed back to the model when the config cannot be repaired. */
  retryPrompt: string | null;
}

/** Params the registry knows, with sane bounds. Out-of-range values are clamped. */
const PARAM_BOUNDS: Record<string, { min: number; max: number; default: number }> = {
  period: { min: 2, max: 500, default: 14 },
  fast: { min: 2, max: 100, default: 12 },
  slow: { min: 3, max: 200, default: 26 },
  signal: { min: 2, max: 50, default: 9 },
  mult: { min: 0.1, max: 10, default: 2 },
  sigma: { min: 1, max: 20, default: 6 },
  k: { min: 2, max: 50, default: 14 },
  d: { min: 1, max: 20, default: 3 },
  smooth: { min: 1, max: 20, default: 3 },
  lookback: { min: 5, max: 200, default: 20 },
  rsiPeriod: { min: 2, max: 100, default: 14 },
  stochPeriod: { min: 2, max: 100, default: 14 },
  p1: { min: 2, max: 50, default: 7 },
  p2: { min: 3, max: 100, default: 14 },
  p3: { min: 5, max: 200, default: 28 },
};

/** Some ids need more history than a short chart provides. Warn, do not block. */
const HEAVY_WARMUP: Record<string, number> = {
  ichimoku: 52, alma: 21, ultimate: 28, aroon: 25, stochrsi: 28,
};

export function validateBotConfig(raw: unknown, o: { barsAvailable?: number } = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const bars = o.barsAvailable ?? 500;
  const cfg = (raw ?? {}) as Partial<BotConfig>;

  // ── name ────────────────────────────────────────────────────────────────
  let name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
  if (!name) {
    name = 'Untitled bot';
    issues.push({ field: 'name', severity: 'error', message: 'No name returned.', fix: 'Named "Untitled bot".' });
  }
  if (name.length > 60) {
    name = name.slice(0, 60);
    issues.push({ field: 'name', severity: 'warning', message: 'Name truncated to 60 characters.' });
  }

  // ── indicators — where hallucinations land ──────────────────────────────
  const rawInds = Array.isArray(cfg.indicators) ? cfg.indicators : [];
  const indicators: BotIndicator[] = [];
  const seen = new Set<string>();

  for (const ind of rawInds) {
    const id = typeof (ind as any)?.id === 'string' ? (ind as any).id.trim().toLowerCase() : '';
    if (!id) {
      issues.push({ field: 'indicators', severity: 'error', message: 'Indicator with no id, dropped.' });
      continue;
    }
    if (!IMPLEMENTED_IDS.has(id)) {
      // The whole point. A plausible-sounding id that computes nothing produces
      // a bot that saves, deploys and never fires.
      const near = nearestId(id);
      issues.push({
        field: `indicators.${id}`, severity: 'error',
        message: `"${id}" is not a real indicator, so this bot would never fire.`
          + (near ? ` Closest match: "${near}".` : ''),
        fix: near ? `Replaced with "${near}".` : 'Dropped.',
      });
      if (near && !seen.has(near)) {
        indicators.push({ id: near, params: clampParams(near, (ind as any)?.params) });
        seen.add(near);
      }
      continue;
    }
    if (seen.has(id)) {
      issues.push({ field: `indicators.${id}`, severity: 'warning', message: `Duplicate "${id}" removed.` });
      continue;
    }
    const params = clampParams(id, (ind as any)?.params);
    const warmup = HEAVY_WARMUP[id] ?? params.period ?? params.slow ?? 14;
    if (warmup > bars * 0.5) {
      issues.push({
        field: `indicators.${id}`, severity: 'warning',
        message: `"${id}" needs ~${warmup} bars of warmup against ${bars} loaded — `
          + `it will produce few signals until more history is available.`,
      });
    }
    indicators.push({ id, params });
    seen.add(id);
  }

  if (indicators.length === 0) {
    issues.push({
      field: 'indicators', severity: 'error',
      message: 'No valid indicators. A bot with nothing to evaluate cannot trade.',
    });
  }
  if (indicators.length > 6) {
    issues.push({
      field: 'indicators', severity: 'warning',
      message: `${indicators.length} indicators. Each condition that must align cuts the signal `
        + `count, and a bot that fires twice a year cannot be evaluated. Three or four is usually plenty.`,
    });
  }

  // ── patterns ────────────────────────────────────────────────────────────
  const rawPatterns = Array.isArray(cfg.candle_patterns) ? cfg.candle_patterns : [];
  const patterns: string[] = [];
  for (const p of rawPatterns) {
    const match = CANDLE_PATTERNS.find(v => v.toLowerCase() === String(p).trim().toLowerCase());
    if (match) patterns.push(match);
    else issues.push({
      field: 'candle_patterns', severity: 'error',
      message: `"${p}" is not a recognised pattern, dropped.`,
    });
  }

  // ── exit rules — the ones that silently ruin a bot ──────────────────────
  const exit = (cfg.exit_rules ?? {}) as BotConfig['exit_rules'];
  let tp = num(exit.tp_pct, 5), sl = num(exit.sl_pct, 2);

  if (sl <= 0) {
    sl = 2;
    issues.push({ field: 'exit_rules.sl_pct', severity: 'error',
      message: 'Stop loss was zero or missing — the position could never close on a loss.',
      fix: 'Set to 2%.' });
  }
  if (tp <= 0) {
    tp = 5;
    issues.push({ field: 'exit_rules.tp_pct', severity: 'error',
      message: 'Take profit was zero or missing.', fix: 'Set to 5%.' });
  }
  if (tp / sl < 1) {
    issues.push({
      field: 'exit_rules', severity: 'warning',
      message: `Reward:risk is ${(tp / sl).toFixed(2)}:1. Below 1:1 the bot needs a win rate above `
        + `${(100 * sl / (sl + tp)).toFixed(0)}% just to break even before fees.`,
    });
  }
  if (sl < 0.5) {
    issues.push({
      field: 'exit_rules.sl_pct', severity: 'warning',
      message: `A ${sl}% stop is inside normal noise on most crypto pairs and will be hit by `
        + `spread and slippage rather than by the trade being wrong.`,
    });
  }

  // ── risk ────────────────────────────────────────────────────────────────
  const risk = (cfg.risk_rules ?? {}) as BotConfig['risk_rules'];
  let maxPos = num(risk.max_position_pct, 10);
  if (maxPos <= 0 || maxPos > 100) {
    maxPos = 10;
    issues.push({ field: 'risk_rules.max_position_pct', severity: 'error',
      message: 'Position size out of range.', fix: 'Set to 10%.' });
  }
  if (maxPos > 50) {
    issues.push({ field: 'risk_rules.max_position_pct', severity: 'warning',
      message: `${maxPos}% of the account in one position. Four losses in a row is most of the account.` });
  }
  const maxLev = risk.max_leverage;
  if (typeof maxLev === 'number' && maxLev > 20) {
    issues.push({ field: 'risk_rules.max_leverage', severity: 'warning',
      message: `${maxLev}x puts liquidation about ${(100 / maxLev).toFixed(1)}% away — inside a `
        + `single normal candle on most pairs.` });
  }

  // ── entry logic ─────────────────────────────────────────────────────────
  const entry = (cfg.entry_rules ?? {}) as BotConfig['entry_rules'];
  const logic = entry.logic === 'OR' ? 'OR' : 'AND';
  if (entry.logic && entry.logic !== 'AND' && entry.logic !== 'OR') {
    issues.push({ field: 'entry_rules.logic', severity: 'error',
      message: `Unknown logic "${entry.logic}".`, fix: 'Set to AND.' });
  }
  if (logic === 'AND' && indicators.length >= 5) {
    issues.push({ field: 'entry_rules', severity: 'warning',
      message: `${indicators.length} indicators all required to agree. Expect very few entries.` });
  }

  const repaired: BotConfig = {
    name,
    description: typeof cfg.description === 'string' ? cfg.description.slice(0, 500) : '',
    indicators,
    candle_patterns: patterns,
    entry_rules: { ...entry, logic },
    exit_rules: { ...exit, mode: exit.mode ?? 'tp_sl', tp_pct: tp, sl_pct: sl },
    risk_rules: { ...risk, max_position_pct: maxPos },
  };

  const fatal = issues.filter(i => i.severity === 'error' && !i.fix);
  const valid = indicators.length > 0 && fatal.length === 0;

  return {
    valid,
    issues,
    repaired,
    retryPrompt: valid ? null : buildRetryPrompt(issues),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampParams(id: string, raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const src = (raw ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    const b = PARAM_BOUNDS[k];
    if (!b) continue;                       // unknown param, drop rather than pass through
    const n = typeof v === 'number' && Number.isFinite(v) ? v : b.default;
    out[k] = Math.min(Math.max(n, b.min), b.max);
  }
  // MACD with fast >= slow produces a flat line. Cheap to catch, invisible otherwise.
  if (id === 'macd' && out.fast !== undefined && out.slow !== undefined && out.fast >= out.slow) {
    out.fast = 12; out.slow = 26;
  }
  return out;
}

/** Levenshtein, for suggesting what the model probably meant. */
function nearestId(id: string): string | null {
  // Models compound real names: "ichimoku_cloud", "rsi_divergence", "macd_hist".
  // Edit distance scores those poorly because the suffix is long, so check for a
  // real id embedded in the string first — it is both cheaper and more accurate.
  const parts = id.split(/[_\-\s]+/).filter(Boolean);
  for (const part of parts) if (IMPLEMENTED_IDS.has(part)) return part;
  for (const known of IMPLEMENTED_IDS) {
    if (known.length >= 3 && (id.startsWith(known) || id.endsWith(known))) return known;
  }
  let best: string | null = null, bestD = Infinity;
  for (const known of IMPLEMENTED_IDS) {
    const d = distance(id, known);
    if (d < bestD) { bestD = d; best = known; }
  }
  // Only suggest a genuinely close match. "rsi_divergence" -> "rsi" is helpful;
  // "quantum_flux" -> "roc" is noise dressed as help.
  return best && bestD <= Math.max(2, Math.floor(id.length * 0.4)) ? best : null;
}

function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[m][n];
}

/**
 * Re-prompt for the model. Giving it the valid ids turns a dead end into a
 * retry that usually succeeds, instead of a saved bot that never fires.
 */
function buildRetryPrompt(issues: ValidationIssue[]): string {
  const errs = issues.filter(i => i.severity === 'error').map(i => `- ${i.message}`).join('\n');
  return `That bot config could not be used:\n${errs}\n\n`
    + `Valid indicator ids are exactly: ${[...IMPLEMENTED_IDS].sort().join(', ')}.\n`
    + `Return corrected JSON using only those ids.`;
}

/** Short summary for the confirmation card. Written for the user, not the log. */
export function summarizeIssues(r: ValidationResult): string {
  const errs = r.issues.filter(i => i.severity === 'error');
  const warns = r.issues.filter(i => i.severity === 'warning');
  if (!errs.length && !warns.length) return 'Config checks out.';
  const parts: string[] = [];
  if (errs.length) parts.push(`${errs.length} ${errs.length === 1 ? 'problem' : 'problems'} fixed`);
  if (warns.length) parts.push(`${warns.length} ${warns.length === 1 ? 'note' : 'notes'}`);
  return parts.join(', ') + '.';
}
