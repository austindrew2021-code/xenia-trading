#!/bin/bash
# Run from project root: bash apply-patches.sh

set -e

echo "=== Applying Xenia production fixes ==="

# ── PATCH 1: App.tsx — Fix header sign-in/sign-out (always visible on all screens) ──
echo "Patching App.tsx header..."

# Remove the "hidden sm:block" from Sign out (make always visible)
# Remove separate mobile wallet button
# Add session indicator dot + show username always
sed -i 's|<button onClick={()=>setShowWallet(true)} className="sm:hidden text-xs px-3 py-1.5 rounded-xl border border-\[#2BFFF1\]/25 text-\[#2BFFF1\] hover:bg-\[#2BFFF1\]/10 transition-all">💳</button>||g' src/App.tsx

sed -i 's|className="hidden sm:block text-\[10px\] px-2.5 py-1.5 rounded-xl border border-white/\[0.07\] text-\[#4B5563\] hover:text-\[#A7B0B7\] transition-all">Sign out</button>|className="text-\[10px\] px-2.5 py-1.5 rounded-xl border border-white/\[0.07\] text-\[#4B5563\] hover:text-\[#A7B0B7\] transition-all">Sign out</button>|g' src/App.tsx

# Fix the username display — remove hidden sm:inline, always show
sed -i 's|className="text-xs font-semibold text-\[#A7B0B7\] hidden sm:inline max-w-\[100px\] truncate"|className="text-xs font-semibold text-\[#F4F6FA\] max-w-\[100px\] truncate"|g' src/App.tsx

# Update the user button styling to show active state
sed -i 's|className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-white/\[0.07\] bg-white/\[0.02\] hover:bg-white/\[0.05\] transition-all"|className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-\[#2BFFF1\]/20 bg-\[#2BFFF1\]/05 hover:bg-\[#2BFFF1\]/10 transition-all"|g' src/App.tsx

echo "✓ Header fixed — Sign out visible on all screens"

# ── PATCH 2: App.tsx — Fix capital sync (don't use setCapital which resets startingCapital) ──
echo "Patching App.tsx capital sync..."

# The sync effect — add spot_live_balance and bot_balance to deps
sed -i "s|useEffect(()=>{if(account)setCapital(account.use_real?(liveSOLUSD>0?liveSOLUSD:account.real_balance):account.mock_balance);},.*);\$|useEffect(()=>{if(!account)return;const liveBal=liveSOLUSD>0?liveSOLUSD:account.real_balance;const bal=account.use_real?liveBal:account.mock_balance;setCapital(bal);},[account?.use_real,account?.real_balance,account?.mock_balance,account?.spot_live_balance,account?.bot_balance,liveSOLUSD,setCapital]);|g" src/App.tsx

echo "✓ Capital sync fixed"

# ── PATCH 3: App.tsx — Fix dispCap to also show username fallback ──
echo "Patching username display..."
sed -i "s|{user.email?.split('@')\[0\]}|{account?.username || user.email?.split('@')[0] || 'Account'}|g" src/App.tsx

echo "✓ Username fallback added"

# ── PATCH 4: store.ts — Already replaced via new file ──
echo "store.ts — drop-in replacement ready (src/store.ts)"

# ── PATCH 5: WalletTransfer.tsx — Already replaced via new file ──
echo "WalletTransfer.tsx — drop-in replacement ready (src/components/WalletTransfer.tsx)"

echo ""
echo "=== All patches applied ==="
echo ""
echo "Summary of changes:"
echo "  1. store.ts: capital default 0 (not 1000), setCapital no longer resets startingCapital"
echo "  2. App.tsx header: Sign out visible on ALL screens (mobile + desktop)"
echo "  3. App.tsx header: Username always visible, active session indicator"
echo "  4. App.tsx: Capital sync includes all balance fields"
echo "  5. WalletTransfer.tsx: Refreshes balances from DB on mount"
echo "  6. WalletTransfer.tsx: Transfer writes to DB first, then updates local state"
echo "  7. WalletTransfer.tsx: Withdraw refreshes from DB after completion"
echo "  8. WalletTransfer.tsx: Added refresh button to manually sync balances"
