import { useEffect, useState } from 'react';
import { XeniaMascot } from './XeniaBot';

interface Props {
  side: 'buy' | 'sell';
  symbol: string;
  amount: string;
  onDone: () => void;
}

const BUY_MESSAGES = [
  "LFG fren! Position opened!",
  "Bags packed. To the moon!",
  "Bought the dip like a legend.",
  "Entry locked in. Let's ride!",
  "Xenia says: bullish activated.",
];
const SELL_MESSAGES = [
  "Profits secured. GG fren!",
  "Sold the top like a chad.",
  "Exit executed. Bag secured!",
  "Take profit like a pro.",
  "Xenia approves — disciplined exit!",
];

// Particle sparkle
function Particle({ delay, angle, color }: { delay: number; angle: number; color: string }) {
  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none"
      style={{ animation: `xenia-particle 0.8s ease-out ${delay}ms forwards`, transform: 'translate(-50%,-50%)' }}>
      <div className="w-2 h-2 rounded-full" style={{ background: color, transform: `rotate(${angle}deg) translateY(-40px)` }}/>
    </div>
  );
}

export function TradeAnimation({ side, symbol, amount, onDone }: Props) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter');
  const msgs = side === 'buy' ? BUY_MESSAGES : SELL_MESSAGES;
  const msg   = msgs[Math.floor(Math.random() * msgs.length)];
  const color = side === 'buy' ? '#4ADE80' : '#F87171';
  const colors = side === 'buy' ? ['#4ADE80','#2BFFF1','#A78BFA','#F59E0B'] : ['#F87171','#FB923C','#FBBF24','#F472B6'];

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 100);
    const t2 = setTimeout(() => setPhase('exit'), 2600);
    const t3 = setTimeout(onDone, 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const particles = Array.from({ length: 12 }, (_, i) => ({
    delay: i * 30,
    angle: (i / 12) * 360,
    color: colors[i % colors.length],
  }));

  return (
    <div className="fixed inset-0 z-[400] pointer-events-none flex items-end justify-center pb-32 md:pb-8">
      <div className="relative"
        style={{
          transform: phase === 'enter' ? 'translateY(40px) scale(0.8)' : phase === 'exit' ? 'translateY(-20px) scale(0.9)' : 'translateY(0) scale(1)',
          opacity: phase === 'hold' ? 1 : 0,
          transition: phase === 'enter' ? 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)' : 'all 0.45s ease-in',
        }}>

        {/* Particle burst */}
        {phase === 'hold' && particles.map((p, i) => <Particle key={i} {...p}/>)}

        {/* Card */}
        <div className="rounded-3xl border shadow-2xl overflow-hidden px-6 py-5 text-center min-w-52"
          style={{ background: 'linear-gradient(135deg, #0B0E14, #0D1117)', borderColor: color + '40', boxShadow: `0 0 40px ${color}30` }}>

          {/* Glow ring */}
          <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{ background: `radial-gradient(circle at 50% 0%, ${color}15, transparent 70%)` }}/>

          <div className="flex flex-col items-center gap-3 relative">
            {/* Mascot with bounce */}
            <div style={{ animation: phase === 'hold' ? 'xenia-bounce 0.6s ease-out' : 'none' }}>
              <XeniaMascot size={52} glow/>
            </div>

            {/* Trade info */}
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }}/>
                <span className="text-sm font-black" style={{ color }}>{side === 'buy' ? 'BOUGHT' : 'SOLD'}</span>
                <span className="text-sm font-black text-[#F4F6FA]">{symbol}</span>
              </div>
              <p className="text-xs text-[#6B7280]">{amount}</p>
            </div>

            {/* Message */}
            <p className="text-[11px] font-bold text-[#A7B0B7] italic">"{msg}"</p>

            {/* Xenia signature */}
            <div className="flex items-center gap-1 text-[9px] text-[#2D3748]">
              <div className="w-1 h-1 rounded-full bg-[#2BFFF1]"/>
              <span>Xenia</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes xenia-bounce {
          0%   { transform: scale(0.5) rotate(-10deg); }
          50%  { transform: scale(1.15) rotate(5deg); }
          75%  { transform: scale(0.95) rotate(-2deg); }
          100% { transform: scale(1) rotate(0); }
        }
        @keyframes xenia-particle {
          0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--tx,0px)), calc(-50% + var(--ty,0px))) scale(0); }
        }
      `}</style>
    </div>
  );
}
