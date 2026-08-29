// ── Xenia Engine — Solana broker (non-custodial, real funds) ───────────────
//
// Implements the same Broker interface the paper broker does, so the runner does
// not know or care which one is attached. Fills are real Jupiter swaps, signed
// by a key the platform never sees and settled directly between the user's own
// wallet and the AMM. Xenia never holds, routes, or has authority over funds.
//
// ─────────────────────────────────────────────────────────────────────────────
// LEVERAGE: THIS VENUE HAS NONE. READ THIS BEFORE SETTING cfg.leverage.
//
// A Jupiter swap is a spot trade. You own the token. There is no margin, no
// funding, and no liquidation price — the position simply loses value. So:
//
//     leverage MUST be 1 and marginFraction is the fraction of the account you
//     are willing to put into one position.
//
// The backtest's liquidation model, funding cost and `skippedStopOutsideLiq`
// counter all describe a perpetuals venue. If you backtest at 10× and then trade
// spot, the live results will not resemble the test — not because the strategy
// failed, but because you measured a different instrument. The constructor
// refuses leverage > 1 rather than letting that mismatch through quietly.
//
// If you want real leverage on Solana it lives in a perps program (Jupiter
// Perps, Drift). That is a different broker with a different fill model, an
// actual liquidation price, and borrow rates — write it as its own class, do not
// bolt a multiplier onto this one.
// ─────────────────────────────────────────────────────────────────────────────
//
// STOPS ARE SYNTHETIC HERE. There is no resting stop order on an AMM. The runner
// evaluates the stop on each closed bar and then sends a market swap. Between
// bar closes you are unprotected, and on a 4h chart that is a four-hour window.
// Size for that. It is the single largest difference between the backtest and
// reality on this venue, larger than fees.

import {
  Connection, Keypair, PublicKey, VersionedTransaction,
} from '@solana/web3.js';
import type { Broker } from './runner';
import type { Side } from './types';

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP = 'https://quote-api.jup.ag/v6/swap';

/** Anything that can sign — an unlocked vault key, or a connected Phantom. */
export interface Signer {
  publicKey: PublicKey;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

export function signerFromKeypair(kp: Keypair): Signer {
  return {
    publicKey: kp.publicKey,
    async signTransaction(tx) { tx.sign([kp]); return tx; },
  };
}

/** Phantom / Solflare injected provider. The key never enters this page. */
export function signerFromWalletAdapter(provider: {
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Signer {
  return { publicKey: provider.publicKey, signTransaction: provider.signTransaction };
}

export interface SolanaBrokerOptions {
  connection: Connection;
  signer: Signer;
  /** Mint of the asset being traded. Quote asset is always USDC. */
  tokenMint: string;
  tokenDecimals: number;
  /** Basis points of allowed price movement between quote and fill. */
  slippageBps?: number;
  /** Priority fee in micro-lamports. Too low and the swap lands late or not at all. */
  priorityFeeMicroLamports?: number;
  /**
   * Platform fee in basis points, from fees.ts. Jupiter takes no protocol fee of
   * its own — this is taken out of the swap and paid to feeAccount, which you own.
   */
  platformFeeBps?: number;
  /**
   * Token account that receives the platform fee. Its mint must be one of the two
   * sides of the swap: for an exact-in swap either the input or output mint, for
   * exact-out the input mint only. A fee account on any other mint makes the
   * quote fail rather than silently collecting nothing.
   */
  feeAccount?: string;
  onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}

interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
}

export class SolanaSpotBroker implements Broker {
  readonly name = 'solana-spot';
  readonly isLive = true;

  private conn: Connection;
  private signer: Signer;
  private mint: string;
  private decimals: number;
  private slippageBps: number;
  private priorityFee: number;
  private platformFeeBps: number;
  private feeAccount?: string;
  private log: (m: string, l?: 'info' | 'warn' | 'error') => void;

  constructor(o: SolanaBrokerOptions & { leverage?: number }) {
    if (o.leverage !== undefined && o.leverage > 1) {
      throw new Error(
        `SolanaSpotBroker cannot trade at ${o.leverage}x. A Jupiter swap is spot — `
        + `there is no margin and no liquidation. Set leverage to 1, or use a perps broker.`,
      );
    }
    this.conn = o.connection;
    this.signer = o.signer;
    this.mint = o.tokenMint;
    this.decimals = o.tokenDecimals;
    this.slippageBps = o.slippageBps ?? 50;          // 0.50%
    this.priorityFee = o.priorityFeeMicroLamports ?? 100_000;
    this.platformFeeBps = o.platformFeeBps ?? 0;
    this.feeAccount = o.feeAccount;
    if (this.platformFeeBps > 0 && !this.feeAccount) {
      throw new Error('platformFeeBps was set without a feeAccount — the fee would be quoted and never collected.');
    }
    this.log = o.onLog ?? (() => {});
  }

  // ── balances ─────────────────────────────────────────────────────────────

  private async tokenBalance(mint: string): Promise<{ raw: bigint; ui: number }> {
    const res = await this.conn.getParsedTokenAccountsByOwner(
      this.signer.publicKey, { mint: new PublicKey(mint) },
    );
    let raw = 0n, ui = 0;
    for (const { account } of res.value) {
      const t = account.data.parsed.info.tokenAmount;
      raw += BigInt(t.amount);
      ui += Number(t.uiAmount ?? 0);
    }
    return { raw, ui };
  }

  /** Account equity in USD: idle USDC plus the mark value of any token held. */
  async getEquity(): Promise<number> {
    const [usdc, tok] = await Promise.all([
      this.tokenBalance(USDC_MINT),
      this.tokenBalance(this.mint),
    ]);
    let markUsd = 0;
    if (tok.raw > 0n) {
      const q = await this.quote(this.mint, USDC_MINT, tok.raw).catch(() => null);
      if (q) markUsd = Number(q.outAmount) / 1e6;
    }
    return usdc.ui + markUsd;
  }

  // ── Jupiter ──────────────────────────────────────────────────────────────

  private async quote(inMint: string, outMint: string, amountRaw: bigint): Promise<JupQuote> {
    const url = `${JUPITER_QUOTE}?inputMint=${inMint}&outputMint=${outMint}`
      + `&amount=${amountRaw.toString()}&slippageBps=${this.slippageBps}`
      + `&onlyDirectRoutes=false&asLegacyTransaction=false`
      + (this.platformFeeBps > 0 ? `&platformFeeBps=${this.platformFeeBps}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Jupiter quote failed (${r.status}).`);
    const j = await r.json();
    if (!j?.outAmount) throw new Error('No route for this pair right now.');
    return j as JupQuote;
  }

  private async executeSwap(q: JupQuote): Promise<{ fillPrice: number; sig: string }> {
    const impact = Math.abs(Number(q.priceImpactPct ?? 0)) * 100;
    if (impact > 3) {
      // Above ~3% the pool is too thin for this size and the backtest's cost
      // model is meaningless. Refusing beats filling at a price no test covered.
      throw new Error(`Price impact ${impact.toFixed(2)}% is too high — reduce size.`);
    }

    const r = await fetch(JUPITER_SWAP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: q,
        userPublicKey: this.signer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        ...(this.feeAccount ? { feeAccount: this.feeAccount } : {}),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: {
          priorityLevel: 'high', maxLamports: this.priorityFee,
        } },
      }),
    });
    if (!r.ok) throw new Error(`Jupiter swap build failed (${r.status}).`);
    const { swapTransaction } = await r.json();
    if (!swapTransaction) throw new Error('Jupiter returned no transaction.');

    const tx = VersionedTransaction.deserialize(
      Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0)),
    );
    const signed = await this.signer.signTransaction(tx);

    const sig = await this.conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false, maxRetries: 3,
    });
    const bh = await this.conn.getLatestBlockhash();
    const conf = await this.conn.confirmTransaction(
      { signature: sig, ...bh }, 'confirmed',
    );
    if (conf.value.err) throw new Error(`Swap failed on chain: ${JSON.stringify(conf.value.err)}`);

    // Price implied by the amounts actually routed, not by the chart. This is
    // the number to reconcile the backtest against.
    const inUi = Number(q.inAmount) / (q.inputMint === USDC_MINT ? 1e6 : 10 ** this.decimals);
    const outUi = Number(q.outAmount) / (q.outputMint === USDC_MINT ? 1e6 : 10 ** this.decimals);
    const fillPrice = q.inputMint === USDC_MINT ? inUi / outUi : outUi / inUi;

    this.log(`swap confirmed ${sig.slice(0, 8)}… fill ${fillPrice.toFixed(6)} `
      + `(impact ${impact.toFixed(2)}%)`);
    return { fillPrice, sig };
  }

  // ── Broker interface ─────────────────────────────────────────────────────

  async open(o: {
    symbol: string; side: Side; marginUsd: number; leverage: number;
    entryHint: number; stop: number; target: number;
  }) {
    try {
      if (o.side < 0) {
        // Spot cannot short. Silently skipping would make the live equity curve
        // diverge from a backtest that took both sides — say so instead.
        return {
          ok: false, fillPrice: 0,
          error: 'Spot cannot short. Use a long-only spec on this venue, or a perps broker.',
        };
      }
      const usdc = await this.tokenBalance(USDC_MINT);
      const wantRaw = BigInt(Math.floor(o.marginUsd * 1e6));
      if (wantRaw > usdc.raw) {
        return { ok: false, fillPrice: 0, error: `Need $${o.marginUsd.toFixed(2)} USDC, have $${usdc.ui.toFixed(2)}.` };
      }
      const q = await this.quote(USDC_MINT, this.mint, wantRaw);
      const { fillPrice } = await this.executeSwap(q);
      return { ok: true, fillPrice };
    } catch (e) {
      return { ok: false, fillPrice: 0, error: (e as Error).message };
    }
  }

  async close(o: { symbol: string; side: Side; notionalUsd: number; exitHint: number }) {
    try {
      const tok = await this.tokenBalance(this.mint);
      if (tok.raw === 0n) return { ok: false, fillPrice: 0, error: 'Nothing to sell.' };
      const q = await this.quote(this.mint, USDC_MINT, tok.raw);
      const { fillPrice } = await this.executeSwap(q);
      return { ok: true, fillPrice };
    } catch (e) {
      return { ok: false, fillPrice: 0, error: (e as Error).message };
    }
  }

  /**
   * Sell everything back to USDC, ignoring strategy state. Wire this to a
   * visible button. A user must always be able to get out in one action without
   * waiting for a bar to close.
   */
  async panicClose(): Promise<{ ok: boolean; error?: string }> {
    const r = await this.close({ symbol: '', side: 1, notionalUsd: 0, exitHint: 0 });
    return { ok: r.ok, error: r.error };
  }
}

/**
 * Real cost of a round trip on this venue, for comparison against the backtest's
 * assumption. Jupiter takes no fee; the cost is the AMM's own fee plus impact
 * plus the priority fee, and impact scales with your size against pool depth.
 */
export async function estimateRoundTripCostPct(
  conn: Connection, tokenMint: string, decimals: number, notionalUsd: number,
): Promise<{ costPct: number; note: string }> {
  const raw = BigInt(Math.floor(notionalUsd * 1e6));
  const url = `${JUPITER_QUOTE}?inputMint=${USDC_MINT}&outputMint=${tokenMint}`
    + `&amount=${raw}&slippageBps=50`;
  const r = await fetch(url);
  if (!r.ok) return { costPct: 0, note: 'Could not price the route.' };
  const q = await r.json();
  const impact = Math.abs(Number(q.priceImpactPct ?? 0)) * 100;
  const costPct = impact * 2 + 0.6;   // both legs, plus a typical AMM fee
  return {
    costPct,
    note: costPct > 1.5
      ? `A round trip costs about ${costPct.toFixed(2)}% here. Against a 1.2 ATR stop on a `
      + `4h chart that is a large fraction of your risk — this pool is too thin for this size.`
      : `A round trip costs about ${costPct.toFixed(2)}% at $${notionalUsd.toFixed(0)} size. `
      + `Set slippagePctPerSide in the backtest to match, or the test is optimistic.`,
  };
}
