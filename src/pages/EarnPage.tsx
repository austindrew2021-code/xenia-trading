import { useState } from 'react';

type TradeType = 'buy' | 'sell';
type Currency  = 'USDC' | 'SOL' | 'ETH' | 'BNB' | 'BTC';
type Fiat      = 'CAD' | 'USD' | 'EUR' | 'GBP' | 'AUD';

const RATES: Record<Currency, number> = { USDC:1, SOL:145, ETH:3200, BNB:580, BTC:87000 };

const MERCHANTS = [
  { name:'CryptoDesk CA', rating:4.9, trades:1243, methods:['E-Transfer','Bank Wire','PayPal'],   limit:'$50–$10,000',  currencies:['USDC','SOL','ETH'],         badge:'Top Seller' },
  { name:'QuickSwap Pro', rating:4.8, trades:876,  methods:['Interac','Cash App','Wise'],         limit:'$20–$5,000',   currencies:['USDC','BTC','ETH','BNB'],    badge:'Fast' },
  { name:'NorthCrypto',   rating:4.7, trades:2104, methods:['Bank Transfer','Revolut'],           limit:'$100–$50,000', currencies:['USDC','SOL','BTC'],          badge:'High Limit' },
  { name:'GlobalFX',      rating:4.6, trades:543,  methods:['PayPal','Venmo','Zelle'],            limit:'$10–$2,000',   currencies:['USDC','ETH','SOL'],          badge:'' },
  { name:'VaultTrader',   rating:4.9, trades:3321, methods:['Bank Wire','SEPA','E-Transfer'],     limit:'$500–$100,000',currencies:['BTC','ETH','USDC','BNB'],   badge:'Verified' },
];

export function P2PPage() {
  const [type,      setType]      = useState<TradeType>('buy');
  const [currency,  setCurrency]  = useState<Currency>('USDC');
  const [fiat,      setFiat]      = useState<Fiat>('CAD');
  const [amount,    setAmount]    = useState('');
  const [showModal, setShowModal] = useState<number | null>(null);

  const rate   = RATES[currency];
  const crypto = amount ? (parseFloat(amount) / rate).toFixed(6) : '';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#F4F6FA] mb-1">P2P Exchange</h1>
        <p className="text-sm text-[#A7B0B7]">Buy and sell crypto directly with other users. Fiat ↔ Crypto, no middleman.</p>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Buy/Sell */}
          <div>
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-1.5">I want to</p>
            <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
              {(['buy','sell'] as TradeType[]).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`flex-1 py-2 text-xs font-bold transition-all capitalize ${type === t ? t === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400' : 'text-[#4B5563]'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Currency */}
          <div>
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-1.5">Crypto</p>
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
              className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none">
              {(Object.keys(RATES) as Currency[]).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Fiat */}
          <div>
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-1.5">Fiat</p>
            <select value={fiat} onChange={e => setFiat(e.target.value as Fiat)}
              className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none">
              {(['CAD','USD','EUR','GBP','AUD'] as Fiat[]).map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Amount */}
          <div>
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-1.5">Amount ({fiat})</p>
            <div className="relative">
              <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
            </div>
            {crypto && <p className="text-[10px] text-[#2BFFF1] mt-1">≈ {crypto} {currency}</p>}
          </div>
        </div>
      </div>

      {/* Rate note */}
      <div className="flex items-center gap-2 mb-4 text-xs text-[#6B7280]">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        1 {currency} = ${rate.toLocaleString()} {fiat} · Indicative rate · Final rate set by merchant
      </div>

      {/* Merchant list */}
      <div className="space-y-3">
        {MERCHANTS.filter(m => m.currencies.includes(currency)).map((m, i) => (
          <div key={i} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/20 flex items-center justify-center font-bold text-[#2BFFF1]">
                  {m.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#F4F6FA]">{m.name}</span>
                    {m.badge && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#2BFFF1]/10 text-[#2BFFF1] border border-[#2BFFF1]/20">{m.badge}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#6B7280] mt-0.5">
                    <span>⭐ {m.rating}</span>
                    <span>·</span>
                    <span>{m.trades.toLocaleString()} trades</span>
                    <span>·</span>
                    <span>{m.limit}</span>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-[#F4F6FA]">${rate.toLocaleString()} {fiat}</p>
                <p className="text-[10px] text-[#4B5563]">per {currency}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-wrap gap-1.5">
                {m.methods.map(method => (
                  <span key={method} className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.07] text-[#6B7280]">{method}</span>
                ))}
              </div>
              <button onClick={() => setShowModal(i)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${type === 'buy' ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
                {type === 'buy' ? 'Buy' : 'Sell'} {currency}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Trade modal */}
      {showModal !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-[#F4F6FA]">Trade with {MERCHANTS[showModal].name}</h3>
              <button onClick={() => setShowModal(null)} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl">×</button>
            </div>
            <div className="space-y-3 mb-5">
              {[
                ['Type', type === 'buy' ? `Buy ${currency}` : `Sell ${currency}`],
                ['Rate', `$${rate.toLocaleString()} ${fiat} / ${currency}`],
                ['Payment', MERCHANTS[showModal].methods.join(', ')],
                ['Limit', MERCHANTS[showModal].limit],
              ].map(([k,v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">{k}</span>
                  <span className="text-[#F4F6FA] font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/20 p-3 mb-5">
              <p className="text-xs text-[#F59E0B]">⚠️ This is a demo marketplace. Real P2P trading will be enabled at platform launch. Never share wallet keys or send funds outside the verified escrow system.</p>
            </div>
            <button onClick={() => setShowModal(null)}
              className="w-full py-3 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 font-bold text-sm hover:bg-[#2BFFF1]/25 transition-all">
              Coming at Launch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
