import { useState, useEffect, useRef } from 'react';
import { useTradingStore } from '../store';
import { useAuth } from '../auth/AuthContext';

interface TouchGrassSettings {
  enabled: boolean;
  threshold: 'scalper' | 'swing';  // 3 losses vs 5-7 losses
  snoozedUntil: number;
  active: boolean;
  activatedAt: number;
}

const DEFAULT_SETTINGS: TouchGrassSettings = {
  enabled: true,
  threshold: 'scalper',
  snoozedUntil: 0,
  active: false,
  activatedAt: 0,
};

const THRESHOLDS = {
  scalper: { losses: 3, label: 'Scalper (3 losses)', desc: 'Triggers after 3 consecutive losses — good for LTF traders' },
  swing:   { losses: 5, label: 'Swing (5 losses)',   desc: 'Triggers after 5 consecutive losses — better for swing traders' },
};

function getConsecutiveLosses(positions: any[]): number {
  const closed = [...positions]
    .filter(p => p.status !== 'open')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  let streak = 0;
  for (const p of closed) {
    if (p.pnl < 0) streak++;
    else break;
  }
  return streak;
}

interface Props {
  show: boolean;
  onClose: () => void;
  onActivate: () => void;
}

export function TouchGrassModal({ show, onClose, onActivate }: Props) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="bg-[#0B0E14] border border-[#4ADE80]/25 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="p-6 text-center">
          <div className="text-5xl mb-4">🌿</div>
          <h2 className="text-lg font-black text-[#F4F6FA] mb-2">Touch Grass Mode</h2>
          <p className="text-sm text-[#A7B0B7] leading-relaxed mb-5">
            We noticed you're on a streak — and it may not be the one you want.<br/>
            <span className="text-[#4ADE80] font-semibold">Activate Touch Grass Mode</span> to stake your remaining funds for the day while you step away.
          </p>
          <div className="rounded-xl border border-[#4ADE80]/15 bg-[#4ADE80]/05 p-3 mb-5 text-left">
            <div className="flex items-start gap-2.5">
              <span className="text-[#4ADE80] text-lg flex-shrink-0">🌱</span>
              <div>
                <p className="text-xs font-bold text-[#F4F6FA] mb-0.5">What happens when you activate:</p>
                <ul className="text-xs text-[#6B7280] space-y-0.5">
                  <li>• All bots pause for 24 hours</li>
                  <li>• Remaining balance auto-staked at 6.5% APY</li>
                  <li>• Trading locked until reset (good thing)</li>
                  <li>• You go touch grass. Seriously.</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose}
              className="py-3 rounded-xl border border-white/[0.08] text-[#6B7280] text-sm font-semibold hover:border-white/20 hover:text-[#A7B0B7] transition-all">
              Skip for now
            </button>
            <button onClick={onActivate}
              className="py-3 rounded-xl bg-[#4ADE80]/20 text-[#4ADE80] border border-[#4ADE80]/30 text-sm font-bold hover:bg-[#4ADE80]/30 transition-all">
              🌿 Activate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TouchGrassActive({ onDeactivate }: { onDeactivate: () => void }) {
  const [timeLeft, setTimeLeft] = useState('');
  const { account } = useAuth();
  const { positions } = useTradingStore();
  const bal = account ? (account.use_real ? account.real_balance : account.mock_balance) : 0;
  const dailyEarning = bal * (0.065 / 365);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const end = now + 24 * 3600 * 1000; // simplify — count from now
      const diff = end - now;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m`);
    };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="rounded-2xl border border-[#4ADE80]/25 bg-[#4ADE80]/05 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌿</span>
          <span className="font-bold text-[#4ADE80] text-sm">Touch Grass Mode Active</span>
        </div>
        <button onClick={onDeactivate}
          className="text-[10px] text-[#4B5563] hover:text-[#A7B0B7] border border-white/[0.07] px-2 py-0.5 rounded-lg transition-all">
          Deactivate
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Staked', `$${bal.toFixed(2)}`],
          ['Earning', `+$${dailyEarning.toFixed(4)}/day`],
          ['Unlocks', '24h'],
        ].map(([l,v]) => (
          <div key={l} className="bg-black/20 rounded-lg p-2">
            <p className="text-[9px] text-[#4B5563]">{l}</p>
            <p className="text-xs font-bold text-[#4ADE80]">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Settings panel shown in a settings modal
export function TouchGrassSettings() {
  const [settings, setSettings] = useState<TouchGrassSettings>(() => {
    try { return JSON.parse(localStorage.getItem('touchgrass') ?? 'null') ?? DEFAULT_SETTINGS; } catch { return DEFAULT_SETTINGS; }
  });

  const save = (patch: Partial<TouchGrassSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem('touchgrass', JSON.stringify(next));
  };

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌿</span>
          <div>
            <p className="text-sm font-bold text-[#F4F6FA]">Touch Grass Mode</p>
            <p className="text-[10px] text-[#4B5563]">Auto-intervention on losing streaks</p>
          </div>
        </div>
        <button onClick={() => save({ enabled: !settings.enabled })}
          className={`relative w-11 h-6 rounded-full transition-all ${settings.enabled ? 'bg-[#4ADE80]/30 border-[#4ADE80]/50' : 'bg-white/[0.05] border-white/[0.08]'} border`}>
          <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all ${settings.enabled ? 'translate-x-5 bg-[#4ADE80]' : 'bg-[#374151]'}`}/>
        </button>
      </div>

      {settings.enabled && (
        <>
          <p className="text-[10px] text-[#6B7280]">Trigger threshold</p>
          <div className="space-y-2">
            {(Object.entries(THRESHOLDS) as [string, typeof THRESHOLDS.scalper][]).map(([key, val]) => (
              <button key={key} onClick={() => save({ threshold: key as any })}
                className={`w-full text-left p-3 rounded-xl border transition-all ${settings.threshold === key ? 'border-[#4ADE80]/40 bg-[#4ADE80]/08' : 'border-white/[0.07] hover:border-white/[0.12]'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${settings.threshold === key ? 'bg-[#4ADE80]' : 'bg-white/[0.1]'}`}/>
                  <div>
                    <p className="text-xs font-semibold text-[#F4F6FA]">{val.label}</p>
                    <p className="text-[9px] text-[#4B5563]">{val.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Main hook — monitors positions and triggers popup
export function useTouchGrass() {
  const { positions, botConfigs, updateBotConfig } = useTradingStore();
  const [showModal, setShowModal]   = useState(false);
  const [grassActive, setGrassActive] = useState(false);
  const lastCheckRef = useRef(0);

  const getSettings = (): TouchGrassSettings => {
    try { return JSON.parse(localStorage.getItem('touchgrass') ?? 'null') ?? DEFAULT_SETTINGS; } catch { return DEFAULT_SETTINGS; }
  };

  useEffect(() => {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (grassActive) return;

    const now = Date.now();
    if (now - lastCheckRef.current < 30000) return; // check every 30s
    lastCheckRef.current = now;

    // Check if snoozed
    if (settings.snoozedUntil > now) return;

    const threshold = THRESHOLDS[settings.threshold].losses;
    const streak = getConsecutiveLosses(positions);

    if (streak >= threshold) {
      setShowModal(true);
    }
  }, [positions, grassActive]);

  const handleActivate = () => {
    setShowModal(false);
    setGrassActive(true);
    // Pause all bots
    updateBotConfig('bot1', { enabled: false });
    updateBotConfig('bot2', { enabled: false });
    updateBotConfig('bot3', { enabled: false });
    // Save activation time
    const s = getSettings();
    localStorage.setItem('touchgrass', JSON.stringify({ ...s, active: true, activatedAt: Date.now() }));
  };

  const handleSkip = () => {
    setShowModal(false);
    // Snooze for 24h
    const s = getSettings();
    localStorage.setItem('touchgrass', JSON.stringify({ ...s, snoozedUntil: Date.now() + 86_400_000 }));
  };

  const handleDeactivate = () => {
    setGrassActive(false);
    const s = getSettings();
    localStorage.setItem('touchgrass', JSON.stringify({ ...s, active: false }));
  };

  return { showModal, grassActive, handleActivate, handleSkip, handleDeactivate };
}
