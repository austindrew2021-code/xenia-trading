import { useState } from 'react';

const STORAGE_KEY = 'xenia-chart-theme';

export interface ChartTheme {
  background:   string;
  upColor:      string;
  downColor:    string;
  upBorder:     string;
  downBorder:   string;
  upWick:       string;
  downWick:     string;
  gridLines:    string;
  crosshair:    string;
  volumeUp:     string;
  volumeDown:   string;
  textColor:    string;
}

export const DEFAULT_THEME: ChartTheme = {
  background:  '#05060B',
  upColor:     '#4ADE80',
  downColor:   '#F87171',
  upBorder:    '#4ADE80',
  downBorder:  '#F87171',
  upWick:      '#22C55E',
  downWick:    '#EF4444',
  gridLines:   'rgba(255,255,255,0.025)',
  crosshair:   'rgba(43,255,241,0.4)',
  volumeUp:    'rgba(74,222,128,0.2)',
  volumeDown:  'rgba(248,113,113,0.2)',
  textColor:   '#4B5563',
};

export const PRESETS: { name: string; theme: ChartTheme }[] = [
  { name: 'Xenia Dark', theme: DEFAULT_THEME },
  {
    name: 'Midnight Blue',
    theme: { ...DEFAULT_THEME, background:'#060B18', upColor:'#38BDF8', downColor:'#F472B6', upBorder:'#38BDF8', downBorder:'#F472B6', upWick:'#0EA5E9', downWick:'#EC4899', crosshair:'rgba(56,189,248,0.4)', volumeUp:'rgba(56,189,248,0.2)', volumeDown:'rgba(244,114,182,0.2)' },
  },
  {
    name: 'Classic Green',
    theme: { ...DEFAULT_THEME, background:'#0A0F0A', upColor:'#00FF7F', downColor:'#FF4040', upBorder:'#00FF7F', downBorder:'#FF4040', upWick:'#00CC66', downWick:'#CC0000', crosshair:'rgba(0,255,127,0.5)', volumeUp:'rgba(0,255,127,0.2)', volumeDown:'rgba(255,64,64,0.2)' },
  },
  {
    name: 'Monochrome',
    theme: { ...DEFAULT_THEME, background:'#0C0C0C', upColor:'#E5E7EB', downColor:'#6B7280', upBorder:'#E5E7EB', downBorder:'#6B7280', upWick:'#F3F4F6', downWick:'#4B5563', crosshair:'rgba(229,231,235,0.4)', volumeUp:'rgba(229,231,235,0.15)', volumeDown:'rgba(107,114,128,0.15)', textColor:'#6B7280' },
  },
  {
    name: 'Synthwave',
    theme: { ...DEFAULT_THEME, background:'#0D0014', upColor:'#A78BFA', downColor:'#F472B6', upBorder:'#A78BFA', downBorder:'#F472B6', upWick:'#7C3AED', downWick:'#DB2777', crosshair:'rgba(167,139,250,0.5)', volumeUp:'rgba(167,139,250,0.2)', volumeDown:'rgba(244,114,182,0.2)' },
  },
  {
    name: 'Solar',
    theme: { ...DEFAULT_THEME, background:'#0F0A00', upColor:'#FBBF24', downColor:'#F97316', upBorder:'#FBBF24', downBorder:'#F97316', upWick:'#F59E0B', downWick:'#EA580C', crosshair:'rgba(251,191,36,0.5)', volumeUp:'rgba(251,191,36,0.2)', volumeDown:'rgba(249,115,22,0.2)' },
  },
];

export function loadChartTheme(): ChartTheme {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return { ...DEFAULT_THEME, ...JSON.parse(s) };
  } catch { /* ignore */ }
  return DEFAULT_THEME;
}

export function saveChartTheme(theme: ChartTheme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

const ColorRow = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
    <span className="text-xs text-[#A7B0B7]">{label}</span>
    <div className="flex items-center gap-2">
      <div className="w-6 h-6 rounded border border-white/[0.15] overflow-hidden cursor-pointer relative">
        <div className="absolute inset-0" style={{ background: value }}/>
        <input type="color" value={value.startsWith('rgba') ? '#2BFFF1' : value}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
      </div>
      <span className="text-[9px] font-mono text-[#374151] w-20 text-right truncate">{value}</span>
    </div>
  </div>
);

interface Props { onClose: () => void; onThemeChange: (t: ChartTheme) => void; }

export function ChartSettings({ onClose, onThemeChange }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(loadChartTheme);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof ChartTheme, val: string) => {
    const next = { ...theme, [key]: val };
    setTheme(next);
    onThemeChange(next);
  };

  const applyPreset = (t: ChartTheme) => { setTheme(t); onThemeChange(t); };

  const save = () => { saveChartTheme(theme); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const reset = () => { applyPreset(DEFAULT_THEME); };

  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-sm shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div>
            <p className="text-sm font-black text-[#F4F6FA]">Chart Appearance</p>
            <p className="text-[10px] text-[#374151]">Customize colors and style</p>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Presets */}
          <div className="p-4 border-b border-white/[0.06]">
            <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Presets</p>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map(p => (
                <button key={p.name} onClick={() => applyPreset(p.theme)}
                  className="rounded-xl border border-white/[0.07] px-2 py-2 text-center hover:border-[#2BFFF1]/30 transition-all group overflow-hidden relative"
                  style={{ background: p.theme.background }}>
                  <div className="flex justify-center gap-0.5 mb-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ background: p.theme.upColor }}/>
                    <div className="w-3 h-3 rounded-sm" style={{ background: p.theme.downColor }}/>
                  </div>
                  <p className="text-[9px] font-semibold text-[#A7B0B7] group-hover:text-[#2BFFF1] transition-all truncate">{p.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom colors */}
          <div className="p-4 space-y-0">
            <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Custom Colors</p>
            <ColorRow label="Background"    value={theme.background}  onChange={v => set('background',  v)}/>
            <ColorRow label="Bull candle"   value={theme.upColor}     onChange={v => set('upColor',     v)}/>
            <ColorRow label="Bear candle"   value={theme.downColor}   onChange={v => set('downColor',   v)}/>
            <ColorRow label="Bull wick"     value={theme.upWick}      onChange={v => set('upWick',      v)}/>
            <ColorRow label="Bear wick"     value={theme.downWick}    onChange={v => set('downWick',    v)}/>
            <ColorRow label="Crosshair"     value={theme.crosshair}   onChange={v => set('crosshair',   v)}/>
            <ColorRow label="Axis text"     value={theme.textColor}   onChange={v => set('textColor',   v)}/>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-white/[0.06] flex-shrink-0">
          <button onClick={reset} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs text-[#4B5563] hover:text-[#A7B0B7] transition-all">Reset</button>
          <button onClick={save} className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: saved ? '#4ADE8025' : 'rgba(43,255,241,0.15)', color: saved ? '#4ADE80' : '#2BFFF1', border: `1px solid ${saved ? '#4ADE8040' : 'rgba(43,255,241,0.25)'}` }}>
            {saved ? 'Saved!' : 'Save Theme'}
          </button>
        </div>
      </div>
    </div>
  );
}
