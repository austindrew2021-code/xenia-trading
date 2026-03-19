import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type DepositAsset = 'SOL' | 'ETH' | 'BNB' | 'BTC' | 'USDC' | 'USDT';

interface Props { onClose: () => void; }

export function WalletDepositModal({ onClose }: Props) {
  const { account, saveAccount, addDeposit, connectWallet } = useAuth();
  const [tab,          setTab]          = useState<'wallet'|'deposit'|'withdraw'>('deposit');
  const [asset,        setAsset]        = useState<DepositAsset>('USDC');
  const [depositAddrs, setDepositAddrs] = useState<Record<string,string>>({});
  const [loadingAddrs, setLoadingAddrs] = useState(true);
  const [copied,       setCopied]       = useState(false);
  const [txHash,       setTxHash]       = useState('');
  const [amount,       setAmount]       = useState('');
  const [submitting,   setSub]          = useState(false);
  const [depositDone,  setDepositDone]  = useState(false);
  const [connecting,   setConnecting]   = useState(false);
  const [walletMsg,    setWalletMsg]    = useState('');
  const [useLive,      setUseLive]      = useState(account?.use_real ?? false);

  // Load or generate user-specific deposit addresses
  useEffect(() => {
    const load = async () => {
      setLoadingAddrs(true);
      // Check if already generated
      if (account?.deposit_wallets && Object.keys(account.deposit_wallets).length > 0) {
        setDepositAddrs(account.deposit_wallets as Record<string,string>);
        setLoadingAddrs(false);
        return;
      }
      // Call edge function to generate
      try {
        const { data: { session } } = await supabase!.auth.getSession();
        const r = await fetch(`${(import.meta as any).env?.VITE_TRADING_SUPABASE_URL}/functions/v1/generate-deposit-wallets`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        const wallets = await r.json();
        setDepositAddrs(wallets);
        await saveAccount({ deposit_wallets: wallets } as any);
      } catch {
        // Fallback placeholder addresses
        setDepositAddrs({
          SOL:'Generating…', ETH:'Generating…', BNB:'Generating…',
          BTC:'Generating…', USDC:'Generating…', USDT:'Generating…',
        });
      }
      setLoadingAddrs(false);
    };
    if (supabase) load();
    else setLoadingAddrs(false);
  }, [account?.deposit_wallets, saveAccount]);

  const addr = depositAddrs[asset] ?? '—';

  const handleCopy = () => {
    navigator.clipboard.writeText(addr).catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleModeSwitch = async (live: boolean) => {
    setUseLive(live);
    await saveAccount({ use_real: live } as any);
  };

  const submitDeposit = async () => {
    if (!amount || !txHash) return;
    setSub(true);
    await addDeposit(txHash, parseFloat(amount), asset, asset === 'SOL' ? 'Solana' : asset === 'BTC' ? 'Bitcoin' : 'EVM');
    setDepositDone(true);
    setSub(false);
  };

  const connectSol = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const p = (window as any).solana || (window as any).phantom?.solana;
      if (!p) { setWalletMsg('Solana wallet not found.'); setConnecting(false); return; }
      const r = await p.connect();
      const a = r.publicKey?.toString();
      if (a) { await connectWallet('sol', a); setWalletMsg(`✓ ${a.slice(0,6)}...${a.slice(-4)}`); }
    } catch (e:any) { setWalletMsg(e.message||'Rejected'); }
    setConnecting(false);
  };

  const connectEvm = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const eth = (window as any).ethereum;
      if (!eth) { setWalletMsg('EVM wallet not found.'); setConnecting(false); return; }
      const accts = await eth.request({ method:'eth_requestAccounts' });
      if (accts?.[0]) { await connectWallet('evm', accts[0]); setWalletMsg(`✓ ${accts[0].slice(0,6)}...${accts[0].slice(-4)}`); }
    } catch (e:any) { setWalletMsg(e.message||'Rejected'); }
    setConnecting(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] sticky top-0 bg-[#0B0E14]">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded-lg" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
            <span className="font-bold text-[#F4F6FA]">Account & Funds</span>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl transition-colors">×</button>
        </div>

        <div className="p-5">
          {/* Balances */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label:'Mock Balance', val:(account?.mock_balance??0).toFixed(2), sub:'Paper trading', live:false, color:'#6B7280' },
              { label:'Real Balance', val:(account?.real_balance??0).toFixed(2), sub:'Deposited funds', live:true, color:'#2BFFF1' },
            ].map(b => (
              <button key={b.label} onClick={() => handleModeSwitch(b.live)}
                className={`rounded-xl border p-3 text-left transition-all ${useLive===b.live ? 'border-[#2BFFF1]/40 bg-[#2BFFF1]/05' : 'border-white/[0.07] bg-white/[0.02] opacity-60'}`}>
                <p className="text-[10px] text-[#4B5563] mb-1">{b.label}</p>
                <p className="text-lg font-bold" style={{ color: useLive===b.live ? b.color : '#F4F6FA' }}>${b.val}</p>
                <p className="text-[10px] text-[#4B5563]">{b.sub}</p>
                {useLive===b.live && <p className="text-[9px] text-[#2BFFF1] mt-1 font-semibold">● Active mode</p>}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl border border-white/[0.07] overflow-hidden mb-5">
            {([['deposit','Deposit'],['withdraw','Withdraw'],['wallet','Wallets']] as const).map(([t,l]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-all ${tab===t?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Deposit tab */}
          {tab === 'deposit' && (
            depositDone ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">✅</div>
                <p className="font-bold text-[#F4F6FA] mb-1">Deposit submitted</p>
                <p className="text-sm text-[#A7B0B7] mb-4">Your real balance will update once confirmed on-chain.</p>
                <button onClick={() => setDepositDone(false)} className="px-4 py-2 rounded-xl text-xs text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/10 transition-all">Deposit more</button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-[#A7B0B7]">Each account has a dedicated deposit address per asset. Send funds there and confirm below.</p>

                {/* Asset picker */}
                <div className="flex flex-wrap gap-1.5">
                  {(['SOL','ETH','BNB','BTC','USDC','USDT'] as DepositAsset[]).map(a => (
                    <button key={a} onClick={() => setAsset(a)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${asset===a?'bg-[#2BFFF1]/15 border-[#2BFFF1]/40 text-[#2BFFF1]':'border-white/[0.08] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                      {a}
                    </button>
                  ))}
                </div>

                {/* Deposit address */}
                <div>
                  <p className="text-[10px] text-[#6B7280] mb-1.5">Your {asset} deposit address</p>
                  {loadingAddrs ? (
                    <div className="h-10 rounded-xl bg-[#05060B] border border-white/[0.08] flex items-center px-3 gap-2">
                      <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
                      <span className="text-xs text-[#4B5563]">Generating your address…</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#05060B] px-3 py-2.5">
                      <p className="font-mono text-xs text-[#A7B0B7] flex-1 break-all">{addr}</p>
                      <button onClick={handleCopy}
                        className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${copied?'text-green-400':'text-[#4B5563] hover:text-[#2BFFF1]'}`}>
                        {copied ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                  <p className="text-[9px] text-[#374151] mt-1">This address is unique to your account. Do not share it.</p>
                </div>

                <div>
                  <label className="text-[10px] text-[#6B7280] mb-1 block">USD value of deposit</label>
                  <input type="number" placeholder="100" value={amount} onChange={e => setAmount(e.target.value)}
                    className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
                </div>
                <div>
                  <label className="text-[10px] text-[#6B7280] mb-1 block">Transaction Hash / Signature</label>
                  <input placeholder="Paste your tx hash after sending" value={txHash} onChange={e => setTxHash(e.target.value)}
                    className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 font-mono" />
                </div>
                <button onClick={submitDeposit} disabled={submitting || !amount || !txHash}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                  {submitting ? 'Submitting…' : 'Confirm Deposit'}
                </button>
                <p className="text-[10px] text-[#374151] text-center">Min $10 · Verified on-chain before crediting</p>
              </div>
            )
          )}

          {/* Withdraw tab */}
          {tab === 'withdraw' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 p-3">
                <p className="text-xs text-[#F59E0B]">⚠️ Withdrawals are processed via P2P. Go to P2P → Sell to exchange crypto for fiat, or connect your wallet to withdraw directly.</p>
              </div>
              <button onClick={onClose} className="w-full py-3 rounded-xl bg-[#A78BFA]/15 text-[#A78BFA] border border-[#A78BFA]/25 font-bold text-sm hover:bg-[#A78BFA]/25 transition-all">
                Go to P2P Exchange
              </button>
            </div>
          )}

          {/* Wallet tab */}
          {tab === 'wallet' && (
            <div className="space-y-3">
              {account?.sol_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">Solana wallet</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.sol_address}</p>
                  </div>
                </div>
              )}
              {account?.evm_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">EVM wallet</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.evm_address}</p>
                  </div>
                </div>
              )}
              <button onClick={connectSol} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#9945FF]/30 bg-[#9945FF]/10 text-[#9945FF] text-sm font-semibold hover:bg-[#9945FF]/20 transition-all disabled:opacity-50">
                {account?.sol_address ? 'Reconnect Solana' : 'Connect Solana Wallet'}
              </button>
              <button onClick={connectEvm} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#F6851B]/30 bg-[#F6851B]/10 text-[#F6851B] text-sm font-semibold hover:bg-[#F6851B]/20 transition-all disabled:opacity-50">
                {account?.evm_address ? 'Reconnect MetaMask / EVM' : 'Connect MetaMask / EVM'}
              </button>
              {walletMsg && (
                <div className={`px-3 py-2.5 rounded-xl text-xs ${walletMsg.startsWith('✓')?'bg-green-500/10 text-green-400 border border-green-500/20':'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
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
