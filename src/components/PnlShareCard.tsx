import { useRef, useState } from 'react';
import { useTradingStore } from '../store';
import { useAuth } from '../auth/AuthContext';

interface Props { onClose: () => void; }

export function PnlShareCard({ onClose }: Props) {
  const { positions, capital, startingCapital } = useTradingStore();
  const { account } = useAuth();
  const cardRef = useRef<HTMLDivElement>(null);
  const [copying, setCopying] = useState(false);

  const closed     = positions.filter(p => p.status !== 'open');
  const totalPnl   = closed.reduce((s,p) => s + p.pnl, 0);
  const wins       = closed.filter(p => p.pnl > 0).length;
  const winRate    = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const cap        = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const totalPct   = ((cap - startingCapital) / startingCapital) * 100;
  const isProfit   = totalPnl >= 0;
  const bestTrade  = closed.length > 0 ? closed.reduce((a,b) => a.pnl > b.pnl ? a : b) : null;
  const worstTrade = closed.length > 0 ? closed.reduce((a,b) => a.pnl < b.pnl ? a : b) : null;

  // Copy card as image using html2canvas if available, else show share text
  const handleShare = async () => {
    setCopying(true);
    const text = `🚀 My Xenia Trading PnL\n\n${isProfit ? '📈' : '📉'} ${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%\nTotal P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}\nWin Rate: ${winRate.toFixed(0)}% (${wins}/${closed.length})\nCapital: $${cap.toFixed(2)}\n\nTrade on xenia-trading.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* skip */ }
    setTimeout(() => setCopying(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm">
        {/* The share card */}
        <div ref={cardRef}
          style={{
            background: isProfit
              ? 'linear-gradient(135deg,#030f0a 0%,#041a10 50%,#030f16 100%)'
              : 'linear-gradient(135deg,#110303 0%,#1a0404 50%,#111118 100%)',
            border: `1px solid ${isProfit ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          }}
          className="rounded-3xl overflow-hidden shadow-2xl mb-3">

          {/* Top glow */}
          <div className="h-1 w-full" style={{
            background: isProfit
              ? 'linear-gradient(90deg,transparent,#4ADE80,transparent)'
              : 'linear-gradient(90deg,transparent,#F87171,transparent)',
          }}/>

          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="Xenia" className="w-8 h-8 rounded-lg"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}/>
                <div>
                  <p className="text-[11px] font-black tracking-[0.3em] uppercase"
                    style={{ color: isProfit ? '#4ADE80' : '#F87171' }}>XENIA</p>
                  <p className="text-[9px] text-[#374151] tracking-widest uppercase">Trading</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-[#374151]">{account?.username ?? 'Trader'}</p>
                <p className="text-[9px] text-[#374151]">{new Date().toLocaleDateString()}</p>
              </div>
            </div>

            {/* Big P&L number */}
            <div className="text-center mb-5">
              <p className="text-[11px] text-[#4B5563] uppercase tracking-widest mb-1">
                {account?.use_real ? 'Live' : 'Mock'} Trading P&L
              </p>
              <p className="text-5xl font-black mb-1"
                style={{
                  color: isProfit ? '#4ADE80' : '#F87171',
                  textShadow: `0 0 30px ${isProfit ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)'}`,
                }}>
                {totalPnl >= 0 ? '+' : ''}${Math.abs(totalPnl).toFixed(2)}
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
                style={{
                  background: isProfit ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                  color: isProfit ? '#4ADE80' : '#F87171',
                  border: `1px solid ${isProfit ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                }}>
                {isProfit ? '▲' : '▼'} {Math.abs(totalPct).toFixed(2)}%
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                ['Capital', `$${cap.toFixed(0)}`],
                ['Win Rate', `${winRate.toFixed(0)}%`],
                ['Trades', closed.length.toString()],
              ].map(([l,v]) => (
                <div key={l} className="text-center p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-[9px] text-[#374151] mb-0.5">{l}</p>
                  <p className="text-sm font-bold text-[#F4F6FA]">{v}</p>
                </div>
              ))}
            </div>

            {/* Best / worst */}
            {bestTrade && (
              <div className="flex gap-2 mb-4">
                <div className="flex-1 p-2 rounded-xl" style={{ background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.15)' }}>
                  <p className="text-[9px] text-[#4B5563] mb-0.5">Best</p>
                  <p className="text-xs font-bold text-green-400">+${bestTrade.pnl.toFixed(2)}</p>
                  <p className="text-[9px] text-[#374151]">{bestTrade.asset}</p>
                </div>
                {worstTrade && (
                  <div className="flex-1 p-2 rounded-xl" style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.15)' }}>
                    <p className="text-[9px] text-[#4B5563] mb-0.5">Worst</p>
                    <p className="text-xs font-bold text-red-400">${worstTrade.pnl.toFixed(2)}</p>
                    <p className="text-[9px] text-[#374151]">{worstTrade.asset}</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="text-center">
              <p className="text-[9px] text-[#1F2937]">xenia-trading.vercel.app</p>
            </div>
          </div>

          {/* Bottom glow */}
          <div className="h-0.5 w-full" style={{
            background: isProfit
              ? 'linear-gradient(90deg,transparent,#4ADE80,transparent)'
              : 'linear-gradient(90deg,transparent,#F87171,transparent)',
          }}/>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/[0.08] text-[#6B7280] text-sm font-semibold hover:text-[#A7B0B7] transition-all">
            Close
          </button>
          <button onClick={handleShare}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border ${
              isProfit
                ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30'
                : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
            }`}>
            {copying ? '✓ Copied!' : '📋 Copy to share'}
          </button>
        </div>
      </div>
    </div>
  );
}
