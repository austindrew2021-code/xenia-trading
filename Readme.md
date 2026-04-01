# Xenia Production Fixes

## Apply Order

```bash
# 1. Drop-in replacements
cp src/store.ts <your-project>/src/store.ts
cp src/components/WalletTransfer.tsx <your-project>/src/components/WalletTransfer.tsx

# 2. From your project root, apply App.tsx patches
bash apply-patches.sh

# 3. Apply SpotTradingPage + leverage live trade patches
bash apply-patches-2.sh

# 4. Clear old localStorage (browser console after deploy)
localStorage.removeItem('xenia-trading-v1')
```

## What Changed

### store.ts (full replacement)
- Default capital `1000` → `0` (no more fake balance)
- `setCapital()` only updates `startingCapital` on first sync (not every tick)
- Added `initCapital()` for explicit resets
- Persist key `xenia-trading-v1` → `xenia-trading-v2` (auto-clears stale data)

### WalletTransfer.tsx (full replacement)
- Fetches fresh balances from DB on mount
- Transfer reads fresh DB row before deducting
- Withdraw refreshes from DB after completion
- Added manual refresh button
- Prevents stale 0 display

### App.tsx (patched via scripts)
- Header: Sign Out visible on ALL screens (mobile + desktop)
- Header: Username always visible with green session indicator
- Header: Separate mobile wallet button removed — unified
- Capital sync: includes spot_live_balance + bot_balance deps
- Username: shows account.username → email fallback → "Account"
- Leverage TradeForm: live trades call platform-wallet-trade edge function + refresh balance from DB

### SpotTradingPage.tsx (patched via script)
- OrderForm: refreshes balance from DB on mount
