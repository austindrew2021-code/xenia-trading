// ── Xenia — Pump.fun pipeline: config and types ───────────────────────────
//
// Port of zostaff/grokbot-pumpfun (MIT) to Xenia's TypeScript runtime.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHICH SOURCE THIS FOLLOWS, AND WHY
//
// The article and the repository disagree. Where they do, the REPOSITORY wins,
// because the article's pipeline provably cannot trade:
//
//   1. compute_score() calls getattr(analysis, k, 0), but TokenAnalyzer.analyze
//      returns a DICT. getattr reads attributes, not keys, so every lookup falls
//      through to the 0 default. Score is always 0.0 -> every token is skipped
//      -> the pipeline never buys anything, ever.
//
//   2. passes_basic_filter requires age_minutes > 2 and unique_buyers >= 5, but
//      subscribeNewToken fires at token CREATION, when both are 0. Nothing
//      re-examines a token later. Even with (1) fixed, nothing passes.
//
//   3. Of the narrative agent's four outputs, only narrative_fit appears in the
//      weights dict. virality, community and timing are computed, paid for, and
//      silently discarded by getattr(narrative, k, 1) returning 1.
//
//   4. self.config is read in run() but never assigned in __init__.
//
// The repo's four-component matrix (audit/narrative/timing/metrics) is also the
// better design: it scores each AGENT's verdict rather than mixing agent outputs
// with raw metrics under shared key names, which is what caused (3).
//
// Everything else — thresholds, weights, agent roles, models, the fail-pessimistic
// rule, dry-run default — is carried across verbatim. Deviations are marked
// DEVIATION and explained.
// ═══════════════════════════════════════════════════════════════════════════

export type PipelineMode = 'mock' | 'live';

export interface PumpToken {
  address: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter: string;
  website: string;
  telegram: string;
  creator: string;
  bondingCurvePct: number;
  uniqueBuyers: number;
  volumeSol: number;
  ageMinutes: number;
  hasMetadata: boolean;
  riskScore: number;        // 1-10 from the data provider, higher = worse
  firstSeen: number;
}

export interface TokenMetrics {
  riskScore: number;
  sniperCount: number;
  insiderPct: number;       // share held by top 5
  creatorPct: number;
  curveHealth: number;      // 1 - insiderPct
  socialSignal: number;     // 0-1, fraction of {twitter, website, telegram}
  walletDiversity: number;
  volumeSol: number;
  marketCap: number;
}

export interface AuditVerdict {
  coordinatedBuys: boolean;
  washTrading: boolean;
  creatorDumpRisk: number;  // 0-1
  organicScore: number;     // 0-1
}

export interface NarrativeVerdict {
  narrativeFit: number;
  virality: number;
  community: number;
  timing: number;
}

export interface TimingVerdict {
  marketMood: number;
  memeSeason: number;
  volumeSignal: number;
  timingScore: number;
}

export interface CheckerVerdict {
  approve: boolean;
  confidence: number;
  riskFlags: string[];
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — mirrors the repo's config.yaml sections
// ═══════════════════════════════════════════════════════════════════════════

export interface PumpConfig {
  mode: PipelineMode;

  grok: {
    apiKey: string;
    fastModel: string;      // three fast agents
    checkerModel: string;   // adversarial checker, stronger model
    timeoutMs: number;
    retries: number;
  };

  solana: {
    rpcUrl: string;
    jitoBlockEngine: string;
    jitoTipLamports: number;
  };

  data: {
    apiKey: string;
    restUrl: string;
    wsUrl: string;
  };

  /** Repo's five limits, unchanged. */
  risk: {
    maxSolPerTrade: number;
    dailyLossLimitSol: number;
    maxDailyTrades: number;
    maxOpenPositions: number;
    stopLossPct: number;
    takeProfitPct: number;
    trailingStopPct: number;
    maxHoldSeconds: number;
    stopLossPollSeconds: number;
  };

  /** Basic filter thresholds, from the article and repo (identical). */
  filter: {
    minUniqueBuyers: number;
    maxBondingCurvePct: number;
    minAgeMinutes: number;
    requireMetadata: boolean;
    maxRiskScore: number;
    minTotalScore: number;
    /** Unconditional vetoes — repo only, absent from the article. */
    vetoCreatorPct: number;
    vetoTop5Pct: number;
  };

  /** Repo's four-component matrix. Normalised, so any scale works. */
  scoring: {
    auditWeight: number;
    narrativeWeight: number;
    timingWeight: number;
    metricsWeight: number;
    timingCacheSeconds: number;
  };

  /** Creator reputation — repo only. */
  reputation: {
    rugLossPct: number;
    blockCreatorAfterRugs: number;
    forgetCreatorsAfterDays: number;
    onePositionPerCreator: boolean;
  };

  /** Grok spend control — repo only, three independent limiters. */
  ops: {
    maxCallsPerMinute: number;
    dailyCallBudget: number;
    breakerFailures: number;
  };
}

/**
 * Defaults exactly as the repo ships them. Every number here is theirs.
 */
export const DEFAULT_PUMP_CONFIG: PumpConfig = {
  mode: 'mock',                              // repo default is dry-run
  grok: {
    apiKey: '',
    fastModel: 'grok-4-fast',
    checkerModel: 'grok-4',
    timeoutMs: 30_000,
    retries: 3,
  },
  solana: {
    rpcUrl: '',
    jitoBlockEngine: 'https://mainnet.block-engine.jito.wtf',
    jitoTipLamports: 10_000,
  },
  data: {
    apiKey: '',
    restUrl: 'https://data.solanatracker.io',
    wsUrl: 'wss://pumpportal.fun/api/data',
  },
  risk: {
    maxSolPerTrade: 0.05,                    // repo's build order: start 0.01-0.05
    dailyLossLimitSol: 0.5,
    maxDailyTrades: 10,
    maxOpenPositions: 3,
    stopLossPct: 50,
    takeProfitPct: 100,
    trailingStopPct: 30,
    maxHoldSeconds: 1800,
    stopLossPollSeconds: 5,
  },
  filter: {
    minUniqueBuyers: 5,
    maxBondingCurvePct: 40,
    minAgeMinutes: 2,
    requireMetadata: true,
    maxRiskScore: 7,
    minTotalScore: 0.6,
    vetoCreatorPct: 25,
    vetoTop5Pct: 80,
  },
  scoring: {
    auditWeight: 0.30,
    narrativeWeight: 0.25,
    timingWeight: 0.15,
    metricsWeight: 0.30,
    timingCacheSeconds: 900,
  },
  reputation: {
    rugLossPct: 60,
    blockCreatorAfterRugs: 2,
    forgetCreatorsAfterDays: 30,
    onePositionPerCreator: true,
  },
  ops: {
    maxCallsPerMinute: 60,
    dailyCallBudget: 2000,
    breakerFailures: 5,
  },
};

export interface ScoreBreakdown {
  audit: number;
  narrative: number;
  timing: number;
  metrics: number;
  total: number;
}

export type SkipStage =
  | 'basic_filter' | 'creator_blocked' | 'creator_open_position'
  | 'high_risk' | 'veto_concentration' | 'auditor' | 'low_score'
  | 'checker' | 'risk_limit' | 'grok_budget';

export interface LogRecord {
  timestamp: string;
  action: 'buy' | 'skip' | 'close';
  token: string;
  name?: string;
  reason?: string;
  detail?: unknown;
  score?: number;
  breakdown?: ScoreBreakdown;
  audit?: AuditVerdict;
  narrative?: NarrativeVerdict;
  timing?: TimingVerdict;
  checker?: CheckerVerdict;
  metrics?: TokenMetrics;
  amountSol?: number;
  entryPrice?: number;
  exitPrice?: number;
  pnlSol?: number;
  pnlPct?: number;
  holdSeconds?: number;
  txHash?: string;
  mode?: PipelineMode;
}
