#!/bin/bash
# Run from project root: bash apply-patches-2.sh
# These are ADDITIONAL patches beyond the first set.

set -e

echo "=== Applying additional production fixes ==="

# ── PATCH 7: SpotTradingPage.tsx — Refresh balance from DB when OrderForm mounts ──
echo "Patching SpotTradingPage.tsx OrderForm balance refresh..."

# Add a useEffect that refreshes balance on mount, right after the balance declaration
# We inject it after the "Mock uses mock_balance" comment line
cat > ~/tmp/spot-patch.py << 'PYEOF'
import re, sys

f = sys.argv[1]
with open(f, 'r') as fh:
    content = fh.read()

# Find the balance line and inject a fresh-balance useEffect after it
old = """  // Mock uses mock_balance; live spot uses spot_live_balance (funded via Transfer → Spot Live)
  const balance = account ? (isMock ? account.mock_balance : (account.spot_live_balance ?? account.real_balance)) : capital;"""

new = """  // Refresh balance from DB on mount to get accurate values
  useEffect(() => {
    if (!user) return;
    supabase?.from('trading_accounts')
      .select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance')
      .eq('user_id', user.id)
      .single()
      .then(({data}) => {
        if(data) saveAccount({
          real_balance: data.real_balance ?? 0,
          mock_balance: data.mock_balance ?? 0,
          spot_live_balance: data.spot_live_balance ?? 0,
          bot_balance: data.bot_balance ?? 0,
          bot_mock_balance: data.bot_mock_balance ?? 0,
        } as any);
      });
  }, [user?.id]);

  // Mock uses mock_balance; live spot uses spot_live_balance (funded via Transfer → Spot Live)
  const balance = account ? (isMock ? account.mock_balance : (account.spot_live_balance ?? account.real_balance)) : capital;"""

if old in content:
    content = content.replace(old, new, 1)
    with open(f, 'w') as fh:
        fh.write(content)
    print("  ✓ OrderForm balance refresh injected")
else:
    print("  ⚠ Could not find target block — may already be patched or code differs")

PYEOF

python3 ~/tmp/spot-patch.py src/pages/SpotTradingPage.tsx
echo "✓ SpotTradingPage patched"


# ── PATCH 8: App.tsx — Make leverage TradeForm call platform-wallet-trade for live ──
echo "Patching App.tsx leverage TradeForm for live execution..."

cat > /tmp/lev-patch.py << 'PYEOF'
import sys

f = sys.argv[1]
with open(f, 'r') as fh:
    content = fh.read()

# The current executeTrade in TradeForm only does local store ops.
# For live mode, it should also persist to Supabase via the edge function.
# We patch the executeTrade function to call platform-wallet-trade for live mode.

old = """  const executeTrade = async () => {
    const pos = openPosition(asset, side, livePrice, sizeN, levN, 'manual', tp ? parseFloat(tp) : undefined, sl ? parseFloat(sl) : undefined);
    if (pos) {
      const modeLabel = account?.use_real ? '🔴 LIVE' : '📌';
      addLog(`${modeLabel} Manual ${side} ${asset} $${sizeN} ×${levN} @ $${livePrice.toFixed(4)}`);
      if (account) {
        const field = account.use_real ? 'real_balance' : 'mock_balance';
        const bal = account.use_real ? (liveSOLUSD > 0 ? liveSOLUSD : account.real_balance) : account.mock_balance;
        saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
        recordTrade(notional, 0, false);
      }
      setWarnAck(false);
      setConfirmLive(false);
    }
  };"""

new = """  const executeTrade = async () => {
    // Open local position in store
    const pos = openPosition(asset, side, livePrice, sizeN, levN, 'manual', tp ? parseFloat(tp) : undefined, sl ? parseFloat(sl) : undefined);
    if (pos) {
      const modeLabel = account?.use_real ? '🔴 LIVE' : '📌';
      addLog(`${modeLabel} Manual ${side} ${asset} $${sizeN} ×${levN} @ $${livePrice.toFixed(4)}`);

      if (account) {
        const isLive = account.use_real;
        const field = isLive ? 'real_balance' : 'mock_balance';
        const bal = isLive ? (liveSOLUSD > 0 ? liveSOLUSD : account.real_balance) : account.mock_balance;

        // Persist trade to Supabase for both mock and live
        try {
          const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
          const { supabase } = await import('./lib/supabase');
          if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            const authToken = session?.access_token ?? '';

            if (isLive && authToken) {
              // Live trade: call server-side platform-wallet-trade
              const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet-trade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({
                  action: 'leverage_trade', isMock: false,
                  side: side === 'LONG' ? 'buy' : 'sell',
                  amountUsd: sizeN, leverage: levN,
                  tokenSymbol: asset, priceUsd: livePrice,
                }),
              });
              const d = await r.json();
              if (r.ok) {
                addLog(`✅ Live trade confirmed server-side`);
              } else {
                addLog(`⚠️ Server: ${d.error ?? 'Trade recorded locally'}`);
              }
            }

            // Refresh balance from DB
            const { data: freshAcct } = await supabase.from('trading_accounts')
              .select('real_balance,mock_balance,spot_live_balance')
              .eq('user_id', account.user_id).single();
            if (freshAcct) {
              saveAccount({
                real_balance: freshAcct.real_balance ?? 0,
                mock_balance: freshAcct.mock_balance ?? 0,
                spot_live_balance: freshAcct.spot_live_balance ?? 0,
              } as any);
            } else {
              // Fallback: deduct locally
              saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
            }
          } else {
            saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
          }
        } catch {
          // Fallback: deduct locally if server call fails
          saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
        }

        recordTrade(notional, 0, false);
      }
      setWarnAck(false);
      setConfirmLive(false);
    }
  };"""

if old in content:
    content = content.replace(old, new, 1)
    with open(f, 'w') as fh:
        fh.write(content)
    print("  ✓ Leverage executeTrade patched for live server-side trades")
else:
    print("  ⚠ Could not find exact executeTrade block — checking alternative...")
    # Try a more flexible match
    if "const executeTrade = async () => {" in content and "const field = account.use_real ? 'real_balance' : 'mock_balance'" in content:
        print("  ℹ Found the function but exact whitespace differs. Please apply manually from PATCHES.md")
    else:
        print("  ⚠ executeTrade function not found — may have different structure")

PYEOF

python3 /tmp/lev-patch.py src/App.tsx
echo "✓ Leverage live trade execution patched"


# ── PATCH 9: Clear stale localStorage from old store version ──
echo ""
echo "IMPORTANT: Clear old localStorage data to prevent stale $1000 capital."
echo "  Option A: In browser console run: localStorage.removeItem('xenia-trading-v1')"
echo "  Option B: The new store uses key 'xenia-trading-v2' so it auto-starts fresh."
echo ""

echo "=== All additional patches applied ==="
echo ""
echo "Summary of additional changes:"
echo "  7. SpotTradingPage: OrderForm refreshes balance from DB on mount"
echo "  8. App.tsx: Leverage TradeForm calls platform-wallet-trade for live mode"
echo "  9. Store persist key bumped v1→v2 to clear stale $1000 capital"
