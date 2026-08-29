// ── Xenia Engine — Features ────────────────────────────────────────────────
//
// Professional trading concepts as verified, CAUSAL detectors.
//
// THE CAUSALITY CONTRACT
//   For every array `a` and every index i:
//       new Features(candles.slice(0, i+1)).a[i]  ===  new Features(candles).a[i]
//
//   The subtle case is swing pivots. A swing high at bar p is only KNOWABLE at
//   bar p + right, because you need `right` bars after it to confirm nothing went
//   higher. Naive implementations write the pivot at index p and the backtest then
//   "sees" it `right` bars early — a silent lookahead that manufactures edge out of
//   nothing. Every pivot-derived series here goes through confirmShift(), which
//   moves the information to the bar where it actually became available.
//
//   Do not "optimise" confirmShift away. Run testCausality() after any change.
//
// Existing xenia bots read `prices: number[]` (closes only) and therefore cannot
// see wicks — which is where sweeps, pin bars and liquidation events live. This
// module works on full OHLCV.

import { Candle, Regime } from './types';

const NaNArr = (n: number) => new Float64Array(n).fill(NaN);
const ZeroArr = (n: number) => new Float64Array(n);

// ── low-level helpers ──────────────────────────────────────────────────────

export function ema(x: Float64Array | number[], span: number): Float64Array {
  const n = x.length, out = new Float64Array(n), a = 2 / (span + 1);
  if (!n) return out;
  out[0] = x[0];
  for (let i = 1; i < n; i++) out[i] = a * x[i] + (1 - a) * out[i - 1];
  return out;
}

/** Wilder's smoothing — what RSI and ATR actually use (not a simple mean). */
export function rma(x: Float64Array | number[], period: number): Float64Array {
  const n = x.length, out = NaNArr(n);
  if (n < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += x[i];
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < n; i++) {
    seed = (seed * (period - 1) + x[i]) / period;
    out[i] = seed;
  }
  return out;
}

export function rollingMax(x: Float64Array | number[], w: number): Float64Array {
  const n = x.length, out = NaNArr(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) if (x[j] > m) m = x[j];
    out[i] = m;
  }
  return out;
}

export function rollingMin(x: Float64Array | number[], w: number): Float64Array {
  const n = x.length, out = NaNArr(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) if (x[j] < m) m = x[j];
    out[i] = m;
  }
  return out;
}

/**
 * THE ANTI-LOOKAHEAD PRIMITIVE.
 * Shift pivot-derived information forward to the bar on which it became knowable.
 */
export function confirmShift(v: Float64Array, right: number): Float64Array {
  const n = v.length, out = NaNArr(n);
  if (right <= 0) return v.slice();
  for (let i = right; i < n; i++) out[i] = v[i - right];
  return out;
}

export function ffill(v: Float64Array): Float64Array {
  const out = v.slice();
  let last = NaN;
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) out[i] = last;
    else last = out[i];
  }
  return out;
}

// ── Features ───────────────────────────────────────────────────────────────

export interface FeatureOpts {
  tfHours?: number;
  pivotLeft?: number;
  pivotRight?: number;
  profileWindow?: number;
  profileBins?: number;
  rsiPeriod?: number;
  atrPeriod?: number;
  rangeWindow?: number;
}

export class Features {
  readonly n: number;
  readonly tfHours: number;
  readonly pl: number;
  readonly pr: number;
  readonly warmup: number;

  // raw
  readonly time: Float64Array;
  readonly o: Float64Array;
  readonly h: Float64Array;
  readonly l: Float64Array;
  readonly c: Float64Array;
  readonly v: Float64Array;

  // volatility
  atr!: Float64Array;
  atrPct!: Float64Array;
  volRatio!: Float64Array;
  volRegime!: Float64Array;   // 0 squeeze, 1 normal, 2 expanding
  squeeze!: Float64Array;

  // structure
  swingHigh!: Float64Array;   // level, published at confirmation bar
  swingLow!: Float64Array;
  lastSh!: Float64Array;
  lastSl!: Float64Array;
  prevSh!: Float64Array;
  prevSl!: Float64Array;
  hh!: Float64Array; hl!: Float64Array; lh!: Float64Array; ll!: Float64Array;
  trendState!: Float64Array;  // 1 up, -1 down, 0 undecided
  bosUp!: Float64Array; bosDown!: Float64Array;
  chochUp!: Float64Array; chochDown!: Float64Array;

  // liquidity
  sweepHigh!: Float64Array; sweepLow!: Float64Array;
  sweepHighDepthAtr!: Float64Array; sweepLowDepthAtr!: Float64Array;
  equalHighs!: Float64Array; equalLows!: Float64Array;
  priorDayHigh!: Float64Array; priorDayLow!: Float64Array;

  // imbalance
  bullFvgLo!: Float64Array; bullFvgHi!: Float64Array;
  bearFvgLo!: Float64Array; bearFvgHi!: Float64Array;
  inBullFvg!: Float64Array; inBearFvg!: Float64Array;
  displacement!: Float64Array;

  // zones
  bullObLo!: Float64Array; bullObHi!: Float64Array;
  bearObLo!: Float64Array; bearObHi!: Float64Array;
  atBullOb!: Float64Array; atBearOb!: Float64Array;

  // value
  poc!: Float64Array; vah!: Float64Array; val!: Float64Array;
  pocDistAtr!: Float64Array;
  inValueArea!: Float64Array; aboveValue!: Float64Array; belowValue!: Float64Array;
  avwapSwing!: Float64Array; avwapSwingSd!: Float64Array; avwapZ!: Float64Array;
  avwapSession!: Float64Array;
  atPoc!: Float64Array; atAvwap!: Float64Array;

  // momentum
  rsi!: Float64Array;
  divRegularBull!: Float64Array; divRegularBear!: Float64Array;
  divHiddenBull!: Float64Array; divHiddenBear!: Float64Array;
  emaFast!: Float64Array; emaSlow!: Float64Array;

  // candles
  pinBull!: Float64Array; pinBear!: Float64Array;
  engulfBull!: Float64Array; engulfBear!: Float64Array;
  insideBar!: Float64Array;

  // location
  rangeHigh!: Float64Array; rangeLow!: Float64Array; rangePos!: Float64Array;
  inPremium!: Float64Array; inDiscount!: Float64Array;

  regime!: Regime[];

  constructor(candles: Candle[], opts: FeatureOpts = {}) {
    const n = candles.length;
    this.n = n;
    this.tfHours = opts.tfHours ?? 4;
    this.pl = opts.pivotLeft ?? 3;
    this.pr = opts.pivotRight ?? 3;

    this.time = new Float64Array(n);
    this.o = new Float64Array(n); this.h = new Float64Array(n);
    this.l = new Float64Array(n); this.c = new Float64Array(n);
    this.v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = candles[i];
      this.time[i] = k.time; this.o[i] = k.open; this.h[i] = k.high;
      this.l[i] = k.low; this.c[i] = k.close;
      this.v[i] = Number.isFinite(k.volume) && k.volume > 0 ? k.volume : 1;
    }

    const profileWindow = opts.profileWindow ?? 120;
    this.buildVolatility(opts.atrPeriod ?? 14);
    this.buildStructure();
    this.buildLiquidity();
    this.buildImbalance();
    this.buildOrderBlocks();
    this.buildProfile(profileWindow, opts.profileBins ?? 48);
    this.buildAvwap();
    this.buildMomentum(opts.rsiPeriod ?? 14);
    this.buildCandles();
    this.buildLocation(opts.rangeWindow ?? 60);
    this.buildRegime();

    this.warmup = Math.max(profileWindow, 60, this.pl + this.pr + 40) + 5;
  }

  // ── volatility ───────────────────────────────────────────────────────────
  private buildVolatility(period: number) {
    const n = this.n, tr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const pc = i === 0 ? this.c[0] : this.c[i - 1];
      tr[i] = Math.max(this.h[i] - this.l[i],
        Math.max(Math.abs(this.h[i] - pc), Math.abs(this.l[i] - pc)));
    }
    this.atr = rma(tr, period);
    this.atrPct = new Float64Array(n);
    const atrMa = rma(tr, period * 4);
    this.volRatio = NaNArr(n);
    this.volRegime = NaNArr(n);
    this.squeeze = ZeroArr(n);
    for (let i = 0; i < n; i++) {
      this.atrPct[i] = this.c[i] > 0 ? (this.atr[i] / this.c[i]) * 100 : NaN;
      if (Number.isFinite(this.atr[i]) && Number.isFinite(atrMa[i]) && atrMa[i] > 0) {
        const r = this.atr[i] / atrMa[i];
        this.volRatio[i] = r;
        this.volRegime[i] = r > 1.35 ? 2 : r < 0.75 ? 0 : 1;
        this.squeeze[i] = r < 0.75 ? 1 : 0;
      }
    }
  }

  // ── market structure ─────────────────────────────────────────────────────
  //  BOS   = break in the direction of the existing trend. Continuation, common,
  //          low information.
  //  CHoCH = the FIRST break against the trend. The earliest evidence control
  //          changed hands, and worth far more than a BOS.
  private buildStructure() {
    const n = this.n, pl = this.pl, pr = this.pr;
    const rawSh = NaNArr(n), rawSl = NaNArr(n);
    for (let i = pl; i < n - pr; i++) {
      let isH = true, isL = true;
      for (let j = i - pl; j <= i + pr; j++) {
        if (this.h[j] > this.h[i]) isH = false;
        if (this.l[j] < this.l[i]) isL = false;
      }
      if (isH && this.h[i] > this.h[i - 1] && this.h[i] >= this.h[i + 1]) rawSh[i] = this.h[i];
      if (isL && this.l[i] < this.l[i - 1] && this.l[i] <= this.l[i + 1]) rawSl[i] = this.l[i];
    }
    this.swingHigh = confirmShift(rawSh, pr);
    this.swingLow = confirmShift(rawSl, pr);
    this.lastSh = ffill(this.swingHigh);
    this.lastSl = ffill(this.swingLow);

    this.prevSh = NaNArr(n); this.prevSl = NaNArr(n);
    const seenH: number[] = [], seenL: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(this.swingHigh[i])) seenH.push(this.swingHigh[i]);
      if (!Number.isNaN(this.swingLow[i])) seenL.push(this.swingLow[i]);
      if (seenH.length >= 2) this.prevSh[i] = seenH[seenH.length - 2];
      if (seenL.length >= 2) this.prevSl[i] = seenL[seenL.length - 2];
    }

    this.hh = ZeroArr(n); this.hl = ZeroArr(n);
    this.lh = ZeroArr(n); this.ll = ZeroArr(n);
    this.trendState = ZeroArr(n);
    for (let i = 0; i < n; i++) {
      this.hh[i] = this.lastSh[i] > this.prevSh[i] ? 1 : 0;
      this.hl[i] = this.lastSl[i] > this.prevSl[i] ? 1 : 0;
      this.lh[i] = this.lastSh[i] < this.prevSh[i] ? 1 : 0;
      this.ll[i] = this.lastSl[i] < this.prevSl[i] ? 1 : 0;
      const prev = i > 0 ? this.trendState[i - 1] : 0;
      this.trendState[i] = this.hh[i] && this.hl[i] ? 1
        : this.lh[i] && this.ll[i] ? -1 : prev;
    }

    this.bosUp = ZeroArr(n); this.bosDown = ZeroArr(n);
    this.chochUp = ZeroArr(n); this.chochDown = ZeroArr(n);
    for (let i = 1; i < n; i++) {
      const sh = this.lastSh[i - 1], sl = this.lastSl[i - 1], t = this.trendState[i - 1];
      if (!Number.isNaN(sh) && this.c[i] > sh && this.c[i - 1] <= sh) {
        if (t >= 0) this.bosUp[i] = 1; else this.chochUp[i] = 1;
      }
      if (!Number.isNaN(sl) && this.c[i] < sl && this.c[i - 1] >= sl) {
        if (t <= 0) this.bosDown[i] = 1; else this.chochDown[i] = 1;
      }
    }
  }

  // ── liquidity ────────────────────────────────────────────────────────────
  //  Sweep = wick takes out a known level, close comes back INSIDE. The close is
  //  the whole distinction: close beyond the level is a break (fading it is
  //  catching a knife); close back inside is a failed raid on resting stops.
  private buildLiquidity(tolAtr = 0.12) {
    const n = this.n;
    this.sweepHigh = ZeroArr(n); this.sweepLow = ZeroArr(n);
    this.sweepHighDepthAtr = NaNArr(n); this.sweepLowDepthAtr = NaNArr(n);
    this.equalHighs = ZeroArr(n); this.equalLows = ZeroArr(n);
    for (let i = 1; i < n; i++) {
      const a = this.atr[i];
      if (!Number.isFinite(a) || a <= 0) continue;
      const sh = this.lastSh[i - 1], sl = this.lastSl[i - 1];
      if (!Number.isNaN(sh) && this.h[i] > sh && this.c[i] < sh) {
        this.sweepHigh[i] = 1;
        this.sweepHighDepthAtr[i] = (this.h[i] - sh) / a;
      }
      if (!Number.isNaN(sl) && this.l[i] < sl && this.c[i] > sl) {
        this.sweepLow[i] = 1;
        this.sweepLowDepthAtr[i] = (sl - this.l[i]) / a;
      }
      if (!Number.isNaN(this.lastSh[i]) && !Number.isNaN(this.prevSh[i]))
        this.equalHighs[i] = Math.abs(this.lastSh[i] - this.prevSh[i]) <= tolAtr * a ? 1 : 0;
      if (!Number.isNaN(this.lastSl[i]) && !Number.isNaN(this.prevSl[i]))
        this.equalLows[i] = Math.abs(this.lastSl[i] - this.prevSl[i]) <= tolAtr * a ? 1 : 0;
    }
    this.buildDailyLevels();
  }

  /**
   * Crypto is 24/7, so "prior day" means the prior UTC day. Levels are published
   * with a one-day lag: you cannot trade yesterday's high until yesterday ended.
   */
  private buildDailyLevels() {
    const n = this.n;
    this.priorDayHigh = NaNArr(n); this.priorDayLow = NaNArr(n);
    let curDay = -1;
    let dHi = NaN, dLo = NaN, lastHi = NaN, lastLo = NaN;
    for (let i = 0; i < n; i++) {
      const day = Math.floor(this.time[i] / 86400000);
      if (curDay < 0 || day !== curDay) {
        lastHi = dHi; lastLo = dLo;
        curDay = day; dHi = NaN; dLo = NaN;
      }
      this.priorDayHigh[i] = lastHi;
      this.priorDayLow[i] = lastLo;
      dHi = Number.isNaN(dHi) ? this.h[i] : Math.max(dHi, this.h[i]);
      dLo = Number.isNaN(dLo) ? this.l[i] : Math.min(dLo, this.l[i]);
    }
  }

  // ── imbalance / FVG ──────────────────────────────────────────────────────
  //  Fair Value Gap: 3-bar imbalance where price moved so fast no trading
  //  happened in a band. Only gaps > minGapAtr matter — smaller ones fill by
  //  accident and generate noise. Mitigated once price trades through 50%.
  private buildImbalance(minGapAtr = 0.25, maxAge = 60) {
    const n = this.n;
    this.bullFvgLo = NaNArr(n); this.bullFvgHi = NaNArr(n);
    this.bearFvgLo = NaNArr(n); this.bearFvgHi = NaNArr(n);
    this.inBullFvg = ZeroArr(n); this.inBearFvg = ZeroArr(n);
    this.displacement = ZeroArr(n);

    let openBull: { bar: number; lo: number; hi: number }[] = [];
    let openBear: { bar: number; lo: number; hi: number }[] = [];

    for (let i = 2; i < n; i++) {
      const a = this.atr[i];
      if (Number.isFinite(a) && a > 0) {
        const body = Math.abs(this.c[i] - this.o[i]);
        if (body >= 1.5 * a) this.displacement[i] = this.c[i] > this.o[i] ? 1 : -1;
        const gLo = this.h[i - 2], gHi = this.l[i];
        if (gHi - gLo >= minGapAtr * a) openBull.push({ bar: i, lo: gLo, hi: gHi });
        const gLo2 = this.h[i], gHi2 = this.l[i - 2];
        if (gHi2 - gLo2 >= minGapAtr * a) openBear.push({ bar: i, lo: gLo2, hi: gHi2 });
      }
      openBull = openBull.filter(g => this.l[i] > (g.lo + g.hi) / 2 && i - g.bar <= maxAge);
      openBear = openBear.filter(g => this.h[i] < (g.lo + g.hi) / 2 && i - g.bar <= maxAge);

      let best: { lo: number; hi: number } | null = null;
      for (const g of openBull) if (g.hi <= this.c[i] && (!best || g.hi > best.hi)) best = g;
      if (best) { this.bullFvgLo[i] = best.lo; this.bullFvgHi[i] = best.hi; }

      let bestB: { lo: number; hi: number } | null = null;
      for (const g of openBear) if (g.lo >= this.c[i] && (!bestB || g.lo < bestB.lo)) bestB = g;
      if (bestB) { this.bearFvgLo[i] = bestB.lo; this.bearFvgHi[i] = bestB.hi; }

      if (best && this.l[i] <= best.hi && this.c[i] >= best.lo) this.inBullFvg[i] = 1;
      if (bestB && this.h[i] >= bestB.lo && this.c[i] <= bestB.hi) this.inBearFvg[i] = 1;
    }
  }

  // ── order blocks ─────────────────────────────────────────────────────────
  //  The last opposing candle before a displacement that breaks structure.
  //  CAUSALITY: an order block is only identifiable AFTER the break, so it is
  //  published at the break bar, never retroactively at the candle itself.
  private buildOrderBlocks(cap = 8) {
    const n = this.n;
    const bLo = NaNArr(n), bHi = NaNArr(n), sLo = NaNArr(n), sHi = NaNArr(n);
    for (let i = 3; i < n; i++) {
      if ((this.bosUp[i] || this.chochUp[i]) && this.displacement[i] > 0) {
        for (let j = i - 1; j > Math.max(i - cap, 0); j--) {
          if (this.c[j] < this.o[j]) { bLo[i] = this.l[j]; bHi[i] = this.h[j]; break; }
        }
      }
      if ((this.bosDown[i] || this.chochDown[i]) && this.displacement[i] < 0) {
        for (let j = i - 1; j > Math.max(i - cap, 0); j--) {
          if (this.c[j] > this.o[j]) { sLo[i] = this.l[j]; sHi[i] = this.h[j]; break; }
        }
      }
    }
    this.bullObLo = ffill(bLo); this.bullObHi = ffill(bHi);
    this.bearObLo = ffill(sLo); this.bearObHi = ffill(sHi);
    this.atBullOb = ZeroArr(n); this.atBearOb = ZeroArr(n);
    for (let i = 0; i < n; i++) {
      if (this.l[i] <= this.bullObHi[i] && this.c[i] >= this.bullObLo[i]) this.atBullOb[i] = 1;
      if (this.h[i] >= this.bearObLo[i] && this.c[i] <= this.bearObHi[i]) this.atBearOb[i] = 1;
    }
  }

  // ── volume profile ───────────────────────────────────────────────────────
  //  POC = price with most traded volume (where the market agreed on value).
  //  Value area = band holding 70% of volume. Volume is spread across each bar's
  //  high-low range rather than dumped on the close — crude, but stable and causal.
  private buildProfile(window: number, bins: number) {
    const n = this.n;
    this.poc = NaNArr(n); this.vah = NaNArr(n); this.val = NaNArr(n);
    this.pocDistAtr = NaNArr(n);
    this.inValueArea = ZeroArr(n); this.aboveValue = ZeroArr(n); this.belowValue = ZeroArr(n);
    const hist = new Float64Array(bins);

    for (let i = window; i < n; i++) {
      const lo = i - window + 1;
      let pmin = Infinity, pmax = -Infinity;
      for (let k = lo; k <= i; k++) {
        if (this.l[k] < pmin) pmin = this.l[k];
        if (this.h[k] > pmax) pmax = this.h[k];
      }
      if (!(pmax > pmin)) continue;
      hist.fill(0);
      const step = (pmax - pmin) / bins;
      for (let k = lo; k <= i; k++) {
        let b0 = Math.floor((this.l[k] - pmin) / step);
        let b1 = Math.floor((this.h[k] - pmin) / step);
        b0 = Math.min(Math.max(b0, 0), bins - 1);
        b1 = Math.min(Math.max(b1, 0), bins - 1);
        const share = this.v[k] / (b1 - b0 + 1);
        for (let b = b0; b <= b1; b++) hist[b] += share;
      }
      let kPoc = 0, total = 0;
      for (let b = 0; b < bins; b++) { total += hist[b]; if (hist[b] > hist[kPoc]) kPoc = b; }
      const centre = (b: number) => pmin + step * (b + 0.5);
      this.poc[i] = centre(kPoc);
      if (total <= 0) continue;
      let loK = kPoc, hiK = kPoc, acc = hist[kPoc];
      while (acc < 0.7 * total && (loK > 0 || hiK < bins - 1)) {
        const dn = loK > 0 ? hist[loK - 1] : -1;
        const up = hiK < bins - 1 ? hist[hiK + 1] : -1;
        if (up >= dn) { hiK++; acc += hist[hiK]; } else { loK--; acc += hist[loK]; }
      }
      this.val[i] = centre(loK); this.vah[i] = centre(hiK);
      if (Number.isFinite(this.atr[i]) && this.atr[i] > 0)
        this.pocDistAtr[i] = (this.c[i] - this.poc[i]) / this.atr[i];
      this.inValueArea[i] = this.c[i] >= this.val[i] && this.c[i] <= this.vah[i] ? 1 : 0;
      this.aboveValue[i] = this.c[i] > this.vah[i] ? 1 : 0;
      this.belowValue[i] = this.c[i] < this.val[i] ? 1 : 0;
    }
  }

  // ── anchored VWAP ────────────────────────────────────────────────────────
  //  The average entry price of everyone positioned since a chosen event.
  //  Reactions off it are those participants defending or capitulating.
  private buildAvwap() {
    const n = this.n;
    this.avwapSwing = NaNArr(n); this.avwapSwingSd = NaNArr(n); this.avwapZ = NaNArr(n);
    this.avwapSession = NaNArr(n);
    let cpv = 0, cv = 0, cp2v = 0;
    for (let i = 0; i < n; i++) {
      const tp = (this.h[i] + this.l[i] + this.c[i]) / 3;
      if (!Number.isNaN(this.swingHigh[i]) || !Number.isNaN(this.swingLow[i])) {
        cpv = 0; cv = 0; cp2v = 0;
      }
      cpv += tp * this.v[i]; cv += this.v[i]; cp2v += tp * tp * this.v[i];
      if (cv > 0) {
        const m = cpv / cv;
        this.avwapSwing[i] = m;
        const sd = Math.sqrt(Math.max(cp2v / cv - m * m, 0));
        this.avwapSwingSd[i] = sd;
        if (sd > 0) this.avwapZ[i] = (this.c[i] - m) / sd;
      }
    }
    let spv = 0, sv = 0, curDay = -1;
    for (let i = 0; i < n; i++) {
      const day = Math.floor(this.time[i] / 86400000);
      if (day !== curDay) { spv = 0; sv = 0; curDay = day; }
      const tp = (this.h[i] + this.l[i] + this.c[i]) / 3;
      spv += tp * this.v[i]; sv += this.v[i];
      if (sv > 0) this.avwapSession[i] = spv / sv;
    }
  }

  // ── momentum / divergence ────────────────────────────────────────────────
  //  Divergence is a MODIFIER, never a trigger. On its own it has poor expectancy
  //  in crypto because trends persist far past the point momentum rolls over.
  //  Note it inherits the pivot confirmation lag — it cannot fire earlier.
  private buildMomentum(period: number) {
    const n = this.n;
    const gain = new Float64Array(n), loss = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const d = this.c[i] - this.c[i - 1];
      gain[i] = d > 0 ? d : 0;
      loss[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gain, period), al = rma(loss, period);
    this.rsi = NaNArr(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(ag[i])) continue;
      this.rsi[i] = al[i] > 1e-12 ? 100 - 100 / (1 + ag[i] / al[i]) : 100;
    }

    this.divRegularBull = ZeroArr(n); this.divRegularBear = ZeroArr(n);
    this.divHiddenBull = ZeroArr(n); this.divHiddenBear = ZeroArr(n);
    const seenL: number[] = [], seenH: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(this.swingLow[i])) seenL.push(i - this.pr);
      if (!Number.isNaN(this.swingHigh[i])) seenH.push(i - this.pr);
      if (seenL.length >= 2) {
        const a = seenL[seenL.length - 2], b = seenL[seenL.length - 1];
        if (Number.isFinite(this.rsi[a]) && Number.isFinite(this.rsi[b])) {
          if (this.l[b] < this.l[a] && this.rsi[b] > this.rsi[a]) this.divRegularBull[i] = 1;
          if (this.l[b] > this.l[a] && this.rsi[b] < this.rsi[a]) this.divHiddenBull[i] = 1;
        }
      }
      if (seenH.length >= 2) {
        const a = seenH[seenH.length - 2], b = seenH[seenH.length - 1];
        if (Number.isFinite(this.rsi[a]) && Number.isFinite(this.rsi[b])) {
          if (this.h[b] > this.h[a] && this.rsi[b] < this.rsi[a]) this.divRegularBear[i] = 1;
          if (this.h[b] < this.h[a] && this.rsi[b] > this.rsi[a]) this.divHiddenBear[i] = 1;
        }
      }
    }
    this.emaFast = ema(this.c, 12);
    this.emaSlow = ema(this.c, 36);
  }

  private buildCandles() {
    const n = this.n;
    this.pinBull = ZeroArr(n); this.pinBear = ZeroArr(n);
    this.engulfBull = ZeroArr(n); this.engulfBear = ZeroArr(n);
    this.insideBar = ZeroArr(n);
    for (let i = 0; i < n; i++) {
      const body = Math.abs(this.c[i] - this.o[i]);
      const rng = this.h[i] - this.l[i];
      if (rng <= 0) continue;
      const lower = Math.min(this.o[i], this.c[i]) - this.l[i];
      const upper = this.h[i] - Math.max(this.o[i], this.c[i]);
      if (lower >= 2 * body && lower >= 0.6 * rng && upper <= body) this.pinBull[i] = 1;
      if (upper >= 2 * body && upper >= 0.6 * rng && lower <= body) this.pinBear[i] = 1;
      if (i > 0) {
        const po = this.o[i - 1], pc = this.c[i - 1];
        if (this.c[i] > this.o[i] && pc < po && this.c[i] >= po && this.o[i] <= pc) this.engulfBull[i] = 1;
        if (this.c[i] < this.o[i] && pc > po && this.c[i] <= po && this.o[i] >= pc) this.engulfBear[i] = 1;
        if (this.h[i] <= this.h[i - 1] && this.l[i] >= this.l[i - 1]) this.insideBar[i] = 1;
      }
    }
  }

  // ── premium / discount ───────────────────────────────────────────────────
  //  Above the midpoint of the range is premium — a bad place to buy. Below is
  //  discount — a bad place to sell. This single filter removes a large fraction
  //  of bad entries at zero cost.
  private buildLocation(window: number) {
    const n = this.n;
    this.rangeHigh = rollingMax(this.h, window);
    this.rangeLow = rollingMin(this.l, window);
    this.rangePos = NaNArr(n);
    this.inPremium = ZeroArr(n); this.inDiscount = ZeroArr(n);
    this.atPoc = ZeroArr(n); this.atAvwap = ZeroArr(n);
    for (let i = 0; i < n; i++) {
      const span = this.rangeHigh[i] - this.rangeLow[i];
      if (span > 0) {
        this.rangePos[i] = (this.c[i] - this.rangeLow[i]) / span;
        this.inPremium[i] = this.rangePos[i] > 0.5 ? 1 : 0;
        this.inDiscount[i] = this.rangePos[i] < 0.5 ? 1 : 0;
      }
      const a = this.atr[i];
      if (Number.isFinite(a) && a > 0) {
        if (Math.abs(this.c[i] - this.poc[i]) < 0.35 * a) this.atPoc[i] = 1;
        if (Math.abs(this.c[i] - this.avwapSwing[i]) < 0.35 * a) this.atAvwap[i] = 1;
      }
    }
  }

  // ── regime ───────────────────────────────────────────────────────────────
  //  Regime is a REPORTING dimension, not a filter the engine applies silently.
  //  Every trade is tagged so expectancy can be read per regime — that is how you
  //  discover a setup is +0.4R in range and -0.3R in trend instead of a
  //  meaningless 0.05R average.
  private buildRegime() {
    this.regime = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.regime[i] = this.volRegime[i] === 2 ? 'highvol'
        : this.trendState[i] > 0 ? 'trend_up'
          : this.trendState[i] < 0 ? 'trend_down' : 'range';
    }
  }

  /** Numeric feature arrays, for the causality test. */
  arrays(): Record<string, Float64Array> {
    const out: Record<string, Float64Array> = {};
    for (const k of Object.keys(this) as (keyof this)[]) {
      const v = this[k];
      if (v instanceof Float64Array && v.length === this.n) out[k as string] = v;
    }
    return out;
  }
}

// ── causality test ─────────────────────────────────────────────────────────

export interface CausalityReport {
  ok: boolean;
  probes: number;
  featuresChecked: number;
  violations: Record<string, number>;
}

/**
 * Features(candles.slice(0,i+1))[name][i] must equal Features(candles)[name][i].
 * If this fails for a feature, that feature can see the future and every backtest
 * result that used it is void. Run after any change to this file.
 */
export function testCausality(candles: Candle[], nProbes = 40, seed = 1): CausalityReport {
  const full = new Features(candles);
  const names = Object.keys(full.arrays());
  const lo = Math.max(full.warmup + 20, 200);
  const violations: Record<string, number> = {};
  if (candles.length <= lo + 10) {
    return { ok: false, probes: 0, featuresChecked: names.length, violations };
  }
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const probes: number[] = [];
  for (let k = 0; k < nProbes; k++) {
    probes.push(lo + Math.floor(rand() * (candles.length - lo)));
  }
  const fullArr = full.arrays();
  for (const i of probes) {
    const part = new Features(candles.slice(0, i + 1)).arrays();
    for (const name of names) {
      const a = part[name][i], b = fullArr[name][i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      if (!(Math.abs(a - b) < 1e-9)) violations[name] = (violations[name] ?? 0) + 1;
    }
  }
  return {
    ok: Object.keys(violations).length === 0,
    probes: probes.length,
    featuresChecked: names.length,
    violations,
  };
}
