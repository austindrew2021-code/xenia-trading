// ── Xenia — Pump.fun execution ────────────────────────────────────────────
//
// Two executors behind one interface, so mock and live share the entire pipeline
// above them. If mock and live diverge, the bug is in the executor, not the
// strategy — which is the point of the split.
//
// ═══════════════════════════════════════════════════════════════════════════
// MOCK MODE USES REAL PRICES
//
// The repo is explicit: "Цены при этом настоящие, поэтому стоп-лосс и PnL в
// dry-run считаются по рынку" — prices are real, so stop-loss and PnL in dry-run
// are computed against the market. A mock mode that simulates prices tells you
// about the simulator. This one only skips the transaction.
//
// What mock still cannot show you: slippage on your own size, MEV, failed
// transactions, and the fact that your buy moves a thin curve. Expect live
// results to be worse than mock even when the logic is identical. Treat the gap
// as data about the venue rather than a bug.
// ═══════════════════════════════════════════════════════════════════════════
//
// ON THE UPSTREAM STUB
// The repo leaves LiveExecutor.buy/.sell as NotImplementedError deliberately,
// with a note that whoever finishes it accepts responsibility for what it does
// with their funds. That boundary is respected here in a different way: live
// execution is implemented, but it is NON-CUSTODIAL — the transaction is built
// remotely and signed by the user's own key through Xenia's existing wallet
// session. Xenia never holds funds and never signs on a user's behalf.

import type { PumpConfig, PumpToken } from './types';

export interface ExecResult {
  ok: boolean;
  txHash: string;
  fillPrice: number;
  error?: string;
}

export interface PumpExecutor {
  readonly mode: 'mock' | 'live';
  buy(token: PumpToken, amountSol: number): Promise<ExecResult>;
  sell(tokenAddress: string, pct: number): Promise<ExecResult>;
  price(tokenAddress: string): Promise<number>;
}

// ── price reading — shared by both modes ───────────────────────────────────

export async function readCurvePrice(
  cfg: PumpConfig, tokenAddress: string,
): Promise<number> {
  try {
    const r = await fetch(`${cfg.data.restUrl}/tokens/${tokenAddress}`, {
      headers: cfg.data.apiKey ? { 'x-api-key': cfg.data.apiKey } : {},
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j?.pools?.[0]?.price?.usd ?? j?.price ?? 0);
  } catch { return 0; }
}

// ── mock ───────────────────────────────────────────────────────────────────

export class MockExecutor implements PumpExecutor {
  readonly mode = 'mock' as const;
  constructor(private cfg: PumpConfig) {}

  async buy(token: PumpToken, amountSol: number): Promise<ExecResult> {
    const p = await this.price(token.address);
    return {
      ok: p > 0, txHash: 'mock', fillPrice: p,
      error: p > 0 ? undefined : 'no price available',
    };
  }

  async sell(tokenAddress: string): Promise<ExecResult> {
    const p = await this.price(tokenAddress);
    return { ok: p > 0, txHash: 'mock', fillPrice: p };
  }

  price(tokenAddress: string) { return readCurvePrice(this.cfg, tokenAddress); }
}

// ── live ───────────────────────────────────────────────────────────────────
//
// Uses PumpPortal's LOCAL trade endpoint, which returns a serialised transaction
// for the client to sign — the custodial "Lightning" endpoint is deliberately
// not used, because handing a third party your key is the opposite of what Xenia
// is. PumpPortal charges 0.5% on top of pump.fun's own ~1.25% curve fee.
//
// Costs to hold in mind when reading any backtest of this: roughly 1.25% curve
// + 0.5% PumpPortal + Jito tip + priority fee, each way.

export interface SignerLike {
  publicKey: { toBase58(): string };
  signAndSend(serializedTx: Uint8Array): Promise<string>;
}

export class LiveExecutor implements PumpExecutor {
  readonly mode = 'live' as const;

  constructor(
    private cfg: PumpConfig,
    private signer: SignerLike,
    private onLog?: (m: string) => void,
  ) {
    if (!cfg.solana.rpcUrl) throw new Error('Live mode requires an RPC URL.');
  }

  private async trade(o: {
    action: 'buy' | 'sell';
    mint: string;
    amount: number | string;
    denominatedInSol: boolean;
    slippagePct: number;
  }): Promise<ExecResult> {
    try {
      const r = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: this.signer.publicKey.toBase58(),
          action: o.action,
          mint: o.mint,
          amount: o.amount,
          denominatedInSol: o.denominatedInSol ? 'true' : 'false',
          slippage: o.slippagePct,
          priorityFee: this.cfg.solana.jitoTipLamports / 1e9,
          pool: 'auto',           // bonding curve pre-graduation, PumpSwap after
        }),
      });
      if (!r.ok) return { ok: false, txHash: '', fillPrice: 0, error: `trade-local http ${r.status}` };

      const bytes = new Uint8Array(await r.arrayBuffer());
      const sig = await this.signer.signAndSend(bytes);
      const fill = await this.price(o.mint);
      this.onLog?.(`${o.action} ${o.mint.slice(0, 8)}… tx ${sig.slice(0, 8)}…`);
      return { ok: true, txHash: sig, fillPrice: fill };
    } catch (e) {
      return { ok: false, txHash: '', fillPrice: 0, error: (e as Error).message };
    }
  }

  buy(token: PumpToken, amountSol: number) {
    return this.trade({
      action: 'buy', mint: token.address, amount: amountSol,
      denominatedInSol: true, slippagePct: 15,
    });
  }

  sell(tokenAddress: string, pct = 100) {
    return this.trade({
      action: 'sell', mint: tokenAddress, amount: `${pct}%`,
      denominatedInSol: false, slippagePct: 15,
    });
  }

  price(tokenAddress: string) { return readCurvePrice(this.cfg, tokenAddress); }
}

// ── the gate between them ──────────────────────────────────────────────────

export interface LiveGateEvidence {
  mockSessionHours: number;
  mockTradesClosed: number;
  hasRpcUrl: boolean;
  hasDataApiKey: boolean;
  hasGrokApiKey: boolean;
  walletUnlocked: boolean;
  walletBackupConfirmed: boolean;
  userAcknowledgedRisk: boolean;
  fundedSol: number;
}

/**
 * The repo requires an explicit --i-understand-the-risk flag to start live, on
 * top of editing the config. This is that gate.
 *
 * The 30-closed-trade threshold is the repo's own number, from the warning
 * scripts/tune.py prints: below ~30 trades you are fitting noise. It is not a
 * promise that 30 is enough to know anything — the research says roughly 0.2-1.5%
 * of pump.fun tokens graduate and 68.67% never trade past their launch day, so a
 * 30-trade sample can easily be 30 losses. It is the floor, not the bar.
 */
export function canEnableLive(e: LiveGateEvidence): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!e.hasGrokApiKey) blockers.push('No Grok API key — the four agents cannot run.');
  if (!e.hasDataApiKey) blockers.push('No data provider key.');
  if (!e.hasRpcUrl) blockers.push('No RPC URL. A public endpoint will rate-limit you out of fills.');
  if (!e.walletUnlocked) blockers.push('Wallet locked. Live signing needs an unlocked session.');
  if (!e.walletBackupConfirmed) blockers.push('Recovery phrase not confirmed.');
  if (e.mockSessionHours < 24) {
    blockers.push(`Only ${e.mockSessionHours.toFixed(1)}h of mock running. Run a full day first — `
      + `launch volume and quality swing hard by hour.`);
  }
  if (e.mockTradesClosed < 30) {
    blockers.push(`${e.mockTradesClosed} closed mock trades. Below 30 the summary is noise.`);
  }
  if (e.fundedSol <= 0) blockers.push('Wallet holds no SOL.');
  if (!e.userAcknowledgedRisk) blockers.push('Risk acknowledgement not given.');
  return { ok: blockers.length === 0, blockers };
}

/**
 * Shown before live is enabled. These figures are from published on-chain
 * research, not from us, and they are the single most useful thing on the screen.
 */
export const LIVE_RISK_DISCLOSURE = {
  title: 'Enable live pump.fun trading',
  facts: [
    'Between 0.2% and 1.5% of pump.fun tokens ever graduate, depending on the study and period.',
    '68.67% of all tokens launched recorded their last trade the same day they were created.',
    'Only about 4.55% survived longer than 90 days.',
    'Of 13.55M wallets that have traded pump.fun, roughly 0.4% ever realised more than $10,000.',
    'The one automation with a documented high win rate (87%) is insider deployer-sniping — '
      + 'coordinated manipulation, not a strategy available to you.',
    'Bonding-curve costs are roughly 1.25% pump.fun + 0.5% PumpPortal each way, before slippage and tips.',
  ],
  fromRepo:
    'The five limits in the config limit the SPEED at which you lose money, not the '
    + 'probability that you will. Neither wallet auditing nor the adversarial check '
    + 'reliably distinguishes a well-prepared dump from organic growth — they only '
    + 'reduce the share of obviously bad entries.',
  ack: 'I understand most pump.fun tokens go to zero and that this is the normal outcome.',
};
