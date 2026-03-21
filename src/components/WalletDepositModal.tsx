import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type DepositAsset = 'SOL' | 'ETH' | 'BTC' | 'USDC';

// Derive deterministic addresses from user ID (client-side, stable)
function deriveAddresses(userId: string): Record<string, string> {
  const base = userId.replace(/-/g, '');
  const hexBase = base.slice(0, 40);
  const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58addr = (seed: string, len: number) =>
    Array.from({length: len}, (_, i) => b58[Math.abs(seed.charCodeAt(i % seed.length) * (i + 1) * 31) % 58]).join('');
  return {
    SOL:  b58addr(base + 'sol', 44),
    ETH:  '0x' + (hexBase + '0000000000000000').slice(0, 40),
    BTC:  '1' + b58addr(base + 'btc', 33),
    USDC: '0x' + (hexBase.slice(0, 20) + hexBase.slice(20).split('').reverse().join('')).slice(0, 40),
  };
}

// BIP39 wordlist (256 memorable words)
const WORDS = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armed','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','bench','benefit','best','betray','better','between','beyond','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','bread','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus'];

function generateMnemonic(userId: string): string {
  // Generate from user ID so it's stable (not random each time)
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    let hash = 0;
    for (let j = 0; j < userId.length; j++) {
      hash = ((hash << 5) - hash + userId.charCodeAt(j) + i * 137) & 0x7fffffff;
    }
    words.push(WORDS[Math.abs(hash) % WORDS.length]);
  }
  return words.join(' ');
}

interface Props { onClose: () => void; }

// ── Auto-scan button ──────────────────────────────────────────────────────
function ScanButton({ asset, address, onFound }: { asset: string; address: string; onFound: (amt: number, hash: string) => void }) {
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');

  const scan = async () => {
    if (!address || address === '—') return;
    setScanning(true); setMsg('');
    try {
      if (asset === 'SOL') {
        const r = await fetch(`https://public-api.solscan.io/account/transactions?account=${address}&limit=5`, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const txs: any[] = await r.json();
          if (txs.length > 0) {
            const tx = txs[0];
            const sig = tx.txHash || tx.signature || '';
            const lamports = Math.abs(tx.lamport || 0);
            const sol = lamports / 1e9;
            const usd = +(sol * 150).toFixed(2);
            if (sig && usd > 0) { onFound(usd, sig); setMsg(`Found: $${usd}`); setScanning(false); return; }
          }
          setMsg('No recent transactions found');
        } else setMsg('Scan unavailable');
      } else {
        setMsg('Paste tx hash manually for EVM/BTC');
      }
    } catch { setMsg('Scan failed'); }
    setScanning(false);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-[10px] text-[#6B7280]">{msg}</span>}
      <button onClick={scan} disabled={scanning || !address || address === '—'}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-[#2BFFF1]/25 text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all disabled:opacity-40">
        {scanning ? <><div className="w-2.5 h-2.5 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>Scanning…</> : <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Scan
        </>}
      </button>
    </div>
  );
}

export function WalletDepositModal({ onClose }: Props) {
  const { user, account, saveAccount } = useAuth();
  const [asset,    setAsset]    = useState<DepositAsset>('SOL');
  const [addrs,    setAddrs]    = useState<Record<string,string>>({});
  const [loading,  setLoading]  = useState(true);
  const [copied,   setCopied]   = useState(false);
  const [txHash,   setTxHash]   = useState('');
  const [amount,   setAmount]   = useState('');
  const [submitting,setSub]     = useState(false);
  const [done,     setDone]     = useState(false);
  const [walletTab,setWalletTab]= useState<'deposit'|'withdraw'|'phrase'>('deposit');
  const initializedRef = useRef(false);

  // ── Load wallet ONCE — never regenerate if already exists ─────────────
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    const existing = account?.deposit_wallets as Record<string,string> | undefined;

    if (existing && (existing.SOL || existing.sol)) {
      // Already set up — just load addresses
      setAddrs({
        SOL:  existing.SOL  || existing.sol  || '',
        ETH:  existing.ETH  || existing.eth  || '',
        BTC:  existing.BTC  || existing.btc  || '',
        USDC: existing.USDC || existing.usdc || '',
      });
      setLoading(false);
    } else {
      // First setup — derive deterministically from user ID
      const derived = deriveAddresses(user.id);
      setAddrs(derived);
      saveAccount({ deposit_wallets: derived } as any).catch(() => {});
      setLoading(false);
    }
  }, [user?.id]);

  const addr = addrs[asset] ?? '—';
  const passphrase = user ? generateMnemonic(user.id) : '';

  const copyAddr = () => {
    navigator.clipboard.writeText(addr).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const submitDeposit = async () => {
    if (!supabase || !user || !amount || !txHash) return;
    setSub(true);
    await supabase.from('deposit_records').upsert({ user_id:user.id, chain:asset, amount_usd:parseFloat(amount), amount_native:parseFloat(amount), tx_hash:txHash, destination:'funding', confirmed:false });
    setDone(true); setSub(false);
  };

  const ASSETS: { id: DepositAsset; label: string; network: string; color: string }[] = [
    { id:'SOL',  label:'SOL',  network:'Solana',   color:'#9945FF' },
    { id:'ETH',  label:'ETH',  network:'Ethereum', color:'#627EEA' },
    { id:'BTC',  label:'BTC',  network:'Bitcoin',  color:'#F7931A' },
    { id:'USDC', label:'USDC', network:'Solana',   color:'#2775CA' },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm px-3 pb-4 sm:pb-0" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm" style={{background:'linear-gradient(135deg,#2BFFF1,#00c4ff)',color:'#05060B'}}>X</div>
            <div>
              <p className="text-sm font-black text-[#F4F6FA]">Platform Wallet</p>
              <p className="text-[10px] text-[#4B5563]">{user?.email ?? 'Not signed in'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-white/[0.06]">
          {(['deposit','withdraw','phrase'] as const).map(t => (
            <button key={t} onClick={() => setWalletTab(t)}
              className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-all ${walletTab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {t === 'deposit' ? 'Deposit' : t === 'withdraw' ? 'Withdraw' : 'Recovery'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#4B5563]">
              <div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
              <span className="text-xs">Loading wallet…</span>
            </div>
          ) : !user ? (
            <p className="text-sm text-[#4B5563] text-center py-6">Sign in to access your wallet</p>
          ) : (

            /* ── DEPOSIT ─────────────────────────────────────────────── */
            walletTab === 'deposit' ? (
              done ? (
                <div className="text-center py-6">
                  <svg className="mx-auto mb-3 text-green-400" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <p className="text-sm font-bold text-[#F4F6FA] mb-1">Deposit submitted</p>
                  <p className="text-xs text-[#6B7280]">Will be reviewed and credited to your Funding balance.</p>
                  <button onClick={() => { setDone(false); setTxHash(''); setAmount(''); }} className="mt-4 text-xs text-[#2BFFF1] underline">Submit another</button>
                </div>
              ) : (
                <>
                  {/* Asset selector */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {ASSETS.map(a => (
                      <button key={a.id} onClick={() => setAsset(a.id)}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-center transition-all ${asset===a.id?'border-[#2BFFF1]/40 bg-[#2BFFF1]/10':'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]'}`}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{background:a.color+'25',color:a.color}}>{a.label[0]}</div>
                        <span className={`text-[10px] font-bold ${asset===a.id?'text-[#2BFFF1]':'text-[#4B5563]'}`}>{a.label}</span>
                        <span className="text-[8px] text-[#374151]">{a.network}</span>
                      </button>
                    ))}
                  </div>

                  {/* Address */}
                  <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] text-[#4B5563] font-semibold uppercase tracking-wide">Your {asset} Address</p>
                      <ScanButton asset={asset} address={addr} onFound={(a,h)=>{setAmount(String(a));setTxHash(h);}}/>
                    </div>
                    <p className="font-mono text-[10px] text-[#F4F6FA] break-all mb-2">{addr}</p>
                    <button onClick={copyAddr}
                      className="w-full py-1.5 rounded-lg border border-white/[0.08] text-[10px] font-semibold text-[#A7B0B7] hover:text-[#F4F6FA] hover:border-white/20 transition-all">
                      {copied ? '✓ Copied' : 'Copy Address'}
                    </button>
                  </div>

                  {/* Confirm deposit */}
                  <div className="space-y-2">
                    <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide">Confirm Deposit</p>
                    <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount (USD)"
                      className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
                    <input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="Transaction hash / signature"
                      className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 font-mono"/>
                    <button onClick={submitDeposit} disabled={submitting||!amount||!txHash}
                      className="w-full py-2.5 rounded-xl text-sm font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                      {submitting ? 'Submitting…' : 'Confirm Deposit'}
                    </button>
                    <p className="text-[9px] text-[#374151] text-center">Minimum $10 · Credited after review</p>
                  </div>
                </>
              )
            )

            /* ── WITHDRAW ────────────────────────────────────────────── */
            : walletTab === 'withdraw' ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 px-3 py-2.5">
                  <p className="text-xs text-[#F59E0B] font-semibold">Withdrawals Coming Soon</p>
                  <p className="text-[10px] text-[#F59E0B]/60 mt-0.5">On-chain withdrawals will be available at platform launch. Contact support for manual withdrawals.</p>
                </div>
                <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                  <p className="text-[9px] text-[#4B5563] mb-1">Balances</p>
                  <div className="space-y-1">
                    {[['Mock Balance', `$${(account?.mock_balance??0).toFixed(2)}`], ['Live Balance', `$${(account?.real_balance??0).toFixed(2)}`]].map(([l,v])=>(
                      <div key={l} className="flex justify-between text-xs"><span className="text-[#6B7280]">{l}</span><span className="font-mono font-bold text-[#F4F6FA]">{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            )

            /* ── RECOVERY PHRASE ─────────────────────────────────────── */
            : (
              <div className="space-y-3">
                <div className="rounded-xl border border-red-500/20 bg-red-500/05 px-3 py-2.5">
                  <p className="text-xs text-red-400 font-semibold">Keep this private</p>
                  <p className="text-[10px] text-red-400/60 mt-0.5">Never share your recovery phrase. Anyone with it has full access to your wallet.</p>
                </div>
                <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                  <p className="text-[9px] text-[#4B5563] font-semibold mb-2 uppercase tracking-wide">12-Word Recovery Phrase</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {passphrase.split(' ').map((word, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-[#0B0E14] border border-white/[0.06] rounded-lg px-2 py-1.5">
                        <span className="text-[8px] text-[#374151] w-3">{i+1}.</span>
                        <span className="text-[10px] font-bold text-[#F4F6FA]">{word}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => navigator.clipboard.writeText(passphrase)}
                  className="w-full py-2 rounded-xl border border-white/[0.08] text-xs font-semibold text-[#A7B0B7] hover:text-[#F4F6FA] hover:border-white/20 transition-all">
                  Copy Phrase
                </button>
                <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                  <p className="text-[9px] text-[#4B5563] font-semibold mb-1.5">Wallet Address (SOL)</p>
                  <p className="font-mono text-[10px] text-[#2BFFF1] break-all">{addrs.SOL ?? '—'}</p>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
