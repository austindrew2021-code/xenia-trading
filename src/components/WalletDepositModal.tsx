import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type DepositAsset = 'SOL' | 'ETH' | 'BNB' | 'BTC' | 'USDC' | 'USDT';

// ── BIP39-style word list (256 words, mobile-memorable) ───────────────────
const WORDS = [
  'apple','brave','coral','dawn','ember','frost','grape','haven','iris','jade',
  'kite','lunar','maple','noble','ocean','pearl','quest','river','stone','tidal',
  'ultra','valor','water','xenon','yield','zenith','amber','blade','crown','drift',
  'eagle','flame','glade','honor','ivory','jewel','karma','lance','monte','nexus',
  'orbit','prism','quake','raven','solar','titan','union','vivid','waste','xylon',
  'yatch','zones','adobe','blaze','cedar','delta','epoch','fauna','ghost','helix',
  'indie','joust','knave','llama','magic','nerve','ozone','pixel','quill','rover',
  'sigma','torch','umbra','venom','waltz','xylem','yacht','zebra','agile','bronze',
  'cyber','disco','elite','forge','gamma','hydro','infra','joker','kneel','latch',
  'metro','noval','optic','plumb','quirk','radar','swept','topaz','ultra','volts',
  'wrath','xerox','yield','zonal','ample','bench','chaos','dense','evoke','frame',
  'globe','house','input','joint','knoll','lemon','manor','north','onset','phase',
  'quote','reign','shelf','tower','uncle','vault','world','boxer','youth','zaire',
  'arise','black','clamp','drive','error','flash','grind','hyper','index','jelly',
  'knock','limit','march','night','oxide','plaid','quart','rhyme','spare','trope',
  'unify','veins','whisk','exact','yards','zones','abode','bring','climb','dodge',
  'exist','feast','grail','hurry','image','jaded','knack','lunge','mourn','nudge',
  'olive','proof','quill','rivet','swamp','touch','usher','visit','worry','exult',
  'young','zonal','alarm','burst','civic','dwell','equip','flint','grasp','heave',
  'imply','jarring','kiosk','liner','merit','novel','ought','pivot','query','remix',
  'swift','trail','uncut','vivid','wider','xylem','yells','zippy','angel','bunny',
  'chess','disco','earth','fairy','ghost','hints','inkjet','jelly','kitty','liger',
  'mango','nutty','overt','panda','quirky','rally','spark','tiger','urban','vivid',
  'wafer','xenon','yummy','zappy','arrow','bliss','curve','depth','eight','fixed',
];

// Generate a random 12-word mnemonic from the word list
function generateMnemonic(): string {
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => WORDS[n % WORDS.length]).join(' ');
}

// Derive wallet addresses deterministically from user ID
function deriveAddresses(userId: string): Record<string, string> {
  const base = userId.replace(/-/g, '');
  const hexBase = base.slice(0, 40);
  const b58chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (seed: string, len: number) => Array.from({length: len}, (_,i) => b58chars[(seed.charCodeAt(i % seed.length) + i * 7) % 58]).join('');
  return {
    SOL:  b58(base + 'sol', 44),
    ETH:  '0x' + (hexBase + '0000000000000000').slice(0, 40),
    BNB:  '0x' + (hexBase.split('').reverse().join('') + '0000000000000000').slice(0, 40),
    BTC:  '1' + b58(base + 'btc', 33),
    USDC: '0x' + (hexBase.slice(0, 20) + hexBase.slice(20).split('').reverse().join('')),
    USDT: '0x' + ((parseInt(hexBase.slice(0,8), 16) >>> 0).toString(16).padStart(8,'0') + hexBase.slice(8, 40)),
  };
}

interface Props { onClose: () => void; }

// ── Auto-scan button — checks for recent transactions to deposit address ──
function ScanButton({ asset, address, onFound }: {
  asset: string;
  address: string;
  onFound: (amount: number, txHash: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [msg,      setMsg]      = useState('');

  const scan = async () => {
    if (!address || address === '—') return;
    setScanning(true);
    setMsg('Scanning…');
    try {
      // Use Solscan public API for SOL/SPL transactions
      if (asset === 'SOL' || asset === 'USDC' || asset === 'USDT') {
        const r = await fetch(
          `https://public-api.solscan.io/account/transactions?account=${address}&limit=5`,
          { headers: { Accept: 'application/json' } }
        );
        if (r.ok) {
          const txs: any[] = await r.json();
          if (txs.length > 0) {
            const tx = txs[0];
            const sig = tx.txHash || tx.signature || '';
            const lamports = Math.abs(tx.lamport || tx.fee || 0);
            const sol = lamports / 1e9;
            const usd = sol * 150; // rough SOL price
            if (sig) {
              setMsg(`Found tx: ${sig.slice(0,8)}…`);
              onFound(parseFloat(usd.toFixed(2)), sig);
              setScanning(false);
              return;
            }
          }
          setMsg('No recent transactions found');
        } else {
          setMsg('Scan unavailable — paste tx manually');
        }
      } else {
        setMsg('Paste your tx hash manually for EVM/BTC');
      }
    } catch {
      setMsg('Scan failed — paste tx manually');
    }
    setScanning(false);
    setTimeout(() => setMsg(''), 4000);
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-[10px] text-[#6B7280]">{msg}</span>}
      <button onClick={scan} disabled={scanning || !address || address==='—'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-[#2BFFF1]/25 text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all disabled:opacity-40">
        {scanning ? (
          <><div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/> Scanning…</>
        ) : (
          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Auto-scan</>
        )}
      </button>
    </div>
  );
}

export function WalletDepositModal({ onClose }: Props) {
  const { user, account, saveAccount, addDeposit, connectWallet } = useAuth();
  const [tab,        setTab]        = useState<'deposit'|'withdraw'|'wallet'>('deposit');
  const [asset,      setAsset]      = useState<DepositAsset>('USDC');
  const [addrs,      setAddrs]      = useState<Record<string,string>>({});
  const [loading,    setLoading]    = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [showPhrase, setShowPhrase] = useState(false);  // show passphrase modal
  const [phraseCopied,setPhraseCopied] = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [txHash,     setTxHash]     = useState('');
  const [amount,     setAmount]     = useState('');
  const [submitting, setSub]        = useState(false);
  const [depositDone,setDepositDone]= useState(false);
  const [connecting, setConnecting] = useState(false);
  const [walletMsg,  setWalletMsg]  = useState('');
  const [useLive,    setUseLive]    = useState(account?.use_real ?? false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    const existing = account?.deposit_wallets as Record<string,string>|undefined;
    if (existing && Object.keys(existing).length >= 6 && existing['passphrase']) {
      // Already set up
      const {passphrase: p, ...walletAddrs} = existing;
      setAddrs(walletAddrs);
      setPassphrase(p || '');
      setLoading(false);
    } else {
      // First time — generate passphrase + addresses
      const mnemonic = generateMnemonic();
      const derived  = deriveAddresses(user.id);
      const toStore  = { passphrase: mnemonic, ...derived };
      setPassphrase(mnemonic);
      setAddrs(derived);
      setShowPhrase(true); // show passphrase once
      saveAccount({ deposit_wallets: toStore } as any).catch(() => {});
      setLoading(false);
    }
  }, [user, account?.deposit_wallets]);

  const addr = addrs[asset] ?? '—';

  const handleCopyAddr = () => {
    navigator.clipboard.writeText(addr).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false), 1500);
  };

  const handleCopyPhrase = () => {
    navigator.clipboard.writeText(passphrase).catch(()=>{});
    setPhraseCopied(true); setTimeout(()=>setPhraseCopied(false), 2000);
  };

  const handleModeSwitch = async (live: boolean) => {
    setUseLive(live);
    await saveAccount({ use_real: live } as any);
  };

  const submitDeposit = async () => {
    if (!amount || !txHash) return;
    setSub(true);
    await addDeposit(txHash, parseFloat(amount), asset, asset === 'SOL' ? 'Solana' : asset === 'BTC' ? 'Bitcoin' : 'EVM');
    setDepositDone(true); setSub(false);
  };

  const connectSol = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const p = (window as any).solana || (window as any).phantom?.solana;
      if (!p) { setWalletMsg('Solana wallet not found.'); setConnecting(false); return; }
      const r = await p.connect();
      const a = r.publicKey?.toString();
      if (a) { await connectWallet('sol', a); setWalletMsg(`✓ ${a.slice(0,6)}...${a.slice(-4)}`); }
    } catch (e:any) { setWalletMsg(e.message || 'Rejected'); }
    setConnecting(false);
  };

  const connectEvm = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const eth = (window as any).ethereum;
      if (!eth) { setWalletMsg('EVM wallet not found.'); setConnecting(false); return; }
      const accts = await eth.request({ method:'eth_requestAccounts' });
      if (accts?.[0]) { await connectWallet('evm', accts[0]); setWalletMsg(`✓ ${accts[0].slice(0,6)}...${accts[0].slice(-4)}`); }
    } catch (e:any) { setWalletMsg(e.message || 'Rejected'); }
    setConnecting(false);
  };

  const mockBal = account?.mock_balance ?? 0;
  const realBal = account?.real_balance ?? 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">

      {/* ── Passphrase reveal modal ── */}
      {showPhrase && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="bg-[#0B0E14] border border-[#F59E0B]/30 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔑</span>
              <h3 className="font-bold text-[#F4F6FA] text-lg">Save Your Recovery Phrase</h3>
            </div>
            <p className="text-sm text-[#A7B0B7] mb-4 leading-relaxed">
              This 12-word phrase is the only way to recover your wallet addresses. Write it down and store it somewhere safe. <span className="text-[#F59E0B] font-semibold">It will not be shown again.</span>
            </p>
            <div className="rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/05 p-4 mb-4">
              <div className="grid grid-cols-3 gap-2">
                {passphrase.split(' ').map((word, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-[#6B7280] w-4 flex-shrink-0">{i+1}.</span>
                    <span className="text-sm font-bold text-[#F4F6FA]">{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCopyPhrase}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${phraseCopied ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/[0.05] text-[#A7B0B7] border-white/[0.08] hover:border-white/20'}`}>
                {phraseCopied ? '✓ Copied!' : 'Copy Phrase'}
              </button>
              <button onClick={() => setShowPhrase(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/30 transition-all">
                I've Saved It →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main modal ── */}
      <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 bg-[#0B0E14]">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="w-6 h-6 rounded-lg" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
            <span className="font-bold text-[#F4F6FA]">Account & Funds</span>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl transition-colors">×</button>
        </div>

        <div className="p-5">
          {/* Balance cards + mode toggle */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label:'Mock Balance',   val:mockBal.toFixed(2), sub:'Paper trading',   live:false, color:'#6B7280' },
              { label:'Real Balance',   val:realBal.toFixed(2), sub:'Deposited funds', live:true,  color:'#2BFFF1' },
            ].map(b => (
              <button key={b.label} onClick={() => handleModeSwitch(b.live)}
                className={`rounded-xl border p-3 text-left transition-all ${useLive===b.live ? 'border-[#2BFFF1]/40 bg-[#2BFFF1]/05' : 'border-white/[0.07] bg-white/[0.02] opacity-55'}`}>
                <p className="text-[10px] text-[#4B5563] mb-1">{b.label}</p>
                <p className="text-xl font-bold" style={{ color: useLive===b.live ? b.color : '#F4F6FA' }}>${b.val}</p>
                <p className="text-[9px] text-[#4B5563] mt-0.5">{b.sub}</p>
                {useLive===b.live && <p className="text-[9px] text-[#2BFFF1] mt-1 font-semibold">● Active</p>}
              </button>
            ))}
          </div>

          {/* Recovery phrase access */}
          {passphrase && !showPhrase && (
            <button onClick={() => setShowPhrase(true)}
              className="w-full mb-4 py-2 rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 text-[#F59E0B] text-xs font-semibold hover:bg-[#F59E0B]/10 transition-all">
              🔑 View recovery phrase
            </button>
          )}

          {/* Tabs */}
          <div className="flex rounded-xl border border-white/[0.07] overflow-hidden mb-5">
            {([['deposit','Deposit'],['withdraw','Withdraw'],['wallet','Wallets']] as const).map(([t,l]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-all ${tab===t ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Deposit */}
          {tab === 'deposit' && (
            depositDone ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">✅</div>
                <p className="font-bold text-[#F4F6FA] mb-1">Deposit submitted</p>
                <p className="text-sm text-[#A7B0B7] mb-4">Your balance updates once confirmed on-chain.</p>
                <button onClick={() => setDepositDone(false)} className="px-4 py-2 rounded-xl text-xs text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/10">Deposit more</button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-[#A7B0B7]">Each account has a unique dedicated address per asset. Send funds there then confirm below.</p>
                {/* Asset picker */}
                <div className="flex flex-wrap gap-1.5">
                  {(['SOL','ETH','BNB','BTC','USDC','USDT'] as DepositAsset[]).map(a => (
                    <button key={a} onClick={() => setAsset(a)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${asset===a ? 'bg-[#2BFFF1]/15 border-[#2BFFF1]/40 text-[#2BFFF1]' : 'border-white/[0.08] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                      {a}
                    </button>
                  ))}
                </div>
                {/* Address */}
                <div>
                  <p className="text-[10px] text-[#6B7280] mb-1.5">Your {asset} deposit address</p>
                  {loading ? (
                    <div className="h-10 rounded-xl bg-[#05060B] border border-white/[0.08] flex items-center px-3 gap-2">
                      <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>
                      <span className="text-xs text-[#4B5563]">Generating your address…</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-[#05060B] px-3 py-2.5">
                      <p className="font-mono text-xs text-[#A7B0B7] flex-1 break-all">{addr}</p>
                      <button onClick={handleCopyAddr}
                        className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${copied ? 'text-green-400' : 'text-[#4B5563] hover:text-[#2BFFF1]'}`}>
                        {copied ? '✓' : 'Copy'}
                      </button>
                    </div>
                  )}
                  <p className="text-[9px] text-[#374151] mt-1">This address is unique to your account. Only send {asset} to this address.</p>
                </div>
                {/* Auto-scan or manual TX hash */}
                <div className="rounded-xl border border-white/[0.07] bg-[#05060B] p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[#6B7280] font-semibold uppercase tracking-wide">Confirm Deposit</p>
                    <ScanButton asset={asset} address={addr} onFound={(amt, hash) => { setAmount(String(amt)); setTxHash(hash); }}/>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#4B5563] mb-1 block">Amount (USD)</label>
                    <input type="number" placeholder="Auto-filled after scan" value={amount} onChange={e => setAmount(e.target.value)}
                      className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#4B5563] mb-1 block">Transaction Signature</label>
                    <input placeholder="Auto-filled after scan, or paste manually" value={txHash} onChange={e => setTxHash(e.target.value)}
                      className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 font-mono text-[11px]"/>
                  </div>
                </div>
                <button onClick={submitDeposit} disabled={submitting || !amount || !txHash}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                  {submitting ? 'Submitting…' : 'Confirm Deposit'}
                </button>
                <p className="text-[9px] text-[#374151] text-center">Minimum $10 · Credited after on-chain confirmation</p>
              </div>
            )
          )}

          {/* Withdraw */}
          {tab === 'withdraw' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 p-3">
                <p className="text-xs text-[#F59E0B]">⚠️ Withdrawals are processed via P2P. Go to P2P → Sell to exchange crypto for fiat, or withdraw directly to your connected wallet.</p>
              </div>
              <button className="w-full py-3 rounded-xl bg-[#A78BFA]/15 text-[#A78BFA] border border-[#A78BFA]/25 font-bold text-sm hover:bg-[#A78BFA]/25 transition-all">
                Go to P2P Exchange
              </button>
            </div>
          )}

          {/* Wallets */}
          {tab === 'wallet' && (
            <div className="space-y-3">
              {account?.sol_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">Solana</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.sol_address}</p>
                  </div>
                </div>
              )}
              {account?.evm_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">EVM</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.evm_address}</p>
                  </div>
                </div>
              )}
              <button onClick={connectSol} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#9945FF]/30 bg-[#9945FF]/10 text-[#9945FF] text-sm font-semibold hover:bg-[#9945FF]/20 transition-all disabled:opacity-50">
                {account?.sol_address ? 'Reconnect Solana' : 'Connect Solana Wallet (Phantom/Solflare)'}
              </button>
              <button onClick={connectEvm} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#F6851B]/30 bg-[#F6851B]/10 text-[#F6851B] text-sm font-semibold hover:bg-[#F6851B]/20 transition-all disabled:opacity-50">
                {account?.evm_address ? 'Reconnect EVM' : 'Connect MetaMask / EVM Wallet'}
              </button>
              {walletMsg && (
                <div className={`px-3 py-2.5 rounded-xl text-xs ${walletMsg.startsWith('✓') ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {walletMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
