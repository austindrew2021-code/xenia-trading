import { useTradingStore } from '../store';
import { useState } from 'react';

interface Props { livePrice: number; }

export function PositionsTable({ livePrice }: Props) {
  const { positions, closePosition, clearClosed } = useTradingStore();
  const [tab, setTab] = useState<'open' | 'history'>('open');

  const open   = positions.filter(p => p.status === 'open');
  const closed = positions.filter(p => p.status !== 'open');

  const botColor: Record<string, string> = {
    bot1: '#2BFFF1', bot2: '#A78BFA', bot3: '#F59E0B', manual: '#6B7280',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 mb-3 flex-shrink-0">
        {(['open','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t === 'open' ? `Open (${open.length})` : `History (${closed.length})`}
          </button>
        ))}
        {tab === 'history' && closed.length > 0 && (
          <button onClick={clearClosed} className="ml-auto text-[10px] text-[#4B5563] hover:text-red-400 transition-colors">Clear</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'open' ? (
          open.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#4B5563]">
              <div className="text-3xl">📊</div>
              <p className="text-sm">No open positions</p>
            </div>
          ) : (
            <div className="space-y-2">
              {open.map(pos => {
                const pnlColor = pos.pnl >= 0 ? '#4ADE80' : '#F87171';
                const sideColor = pos.side === 'LONG' ? '#4ADE80' : '#F87171';
                const liqDist = pos.side === 'LONG'
                  ? ((livePrice - pos.liquidationPrice) / livePrice * 100)
                  : ((pos.liquidationPrice - livePrice) / livePrice * 100);
                return (
                  <div key={pos.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 hover:border-white/[0.12] transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#F4F6FA]">{pos.asset}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ color: sideColor, background: sideColor + '20' }}>
                          {pos.side} {pos.leverage}×
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: botColor[pos.openedBy], background: botColor[pos.openedBy] + '20' }}>
                          {pos.openedBy.toUpperCase()}
                        </span>
                      </div>
                      <button onClick={() => closePosition(pos.id, livePrice)}
                        className="text-[10px] text-[#4B5563] hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                        Close
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs mb-2">
                      <div>
                        <p className="text-[10px] text-[#4B5563]">Entry</p>
                        <p className="text-[#A7B0B7]">${pos.entryPrice.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#4B5563]">Mark</p>
                        <p className="text-[#F4F6FA]">${livePrice.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#4B5563]">PnL</p>
                        <p className="font-bold" style={{ color: pnlColor }}>
                          {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)} ({pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(1)}%)
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#4B5563]">Size</p>
                        <p className="text-[#A7B0B7]">${pos.size.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#4B5563]">Notional</p>
                        <p className="text-[#A7B0B7]">${pos.notional.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#4B5563]">Liq dist.</p>
                        <p style={{ color: liqDist < 5 ? '#F87171' : '#6B7280' }}>{liqDist.toFixed(1)}%</p>
                      </div>
                    </div>
                    {/* PnL bar */}
                    <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(Math.abs(pos.pnlPct), 100)}%`, background: pnlColor }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          closed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#4B5563]">
              <p className="text-sm">No closed trades yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {closed.map(pos => {
                const win = pos.pnl > 0;
                return (
                  <div key={pos.id} className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#A7B0B7]">{pos.asset}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                          color: pos.side === 'LONG' ? '#4ADE80' : '#F87171',
                          background: (pos.side === 'LONG' ? '#4ADE80' : '#F87171') + '20',
                        }}>{pos.side}</span>
                        {pos.status === 'liquidated' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">LIQ</span>
                        )}
                      </div>
                      <span className={`text-xs font-bold ${win ? 'text-green-400' : 'text-red-400'}`}>
                        {win ? '+' : ''}{pos.pnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#4B5563]">
                      <span>Entry ${pos.entryPrice.toFixed(4)}</span>
                      <span>→</span>
                      <span>Close ${pos.closePrice?.toFixed(4)}</span>
                      <span className="ml-auto">{pos.openedBy.toUpperCase()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
