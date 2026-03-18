import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

// Deposit addresses (same as presale site)
const DEPOSIT_ADDRESSES = {
  SOL:  'HAEC8fjg9Wpg1wpL8j5EQFRmrq4dj8BqYQVKgZZdKmRM',
  ETH:  '0x0722Ef1DCfa7849B3BF0DB375793bFAcc52b8e39',
  BNB:  '0x0722Ef1DCfa7849B3BF0DB375793bFAcc52b8e39',
  USDC: '0x0722Ef1DCfa7849B3BF0DB375793bFAcc52b8e39',
  BTC:  'bc1q3rdjpm36lcy30amzfkaqpvvm5xu8n8y665ajlx',
};

type DepositAsset = keyof typeof DEPOSIT_ADDRESSES;
interface Props { onClose: () => void; }

function copyText(t: string) { navigator.clipboard.writeText(t).catch(() => {}); }

export function WalletDepositModal({ onClose }: Props) {
  const { account, connectWallet, addDeposit } = useAuth();
  const [tab, setTab] = useState<'wallet' | 'deposit'>('wallet');

  // Wallet connect
  const [connecting, setConnecting] = useState(false);
  const [walletMsg, setWalletMsg]   = useState('');

  const connectSol = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const provider = (window as any).solana || (window as any).phantom?.solana;
      if (!provider) { setWalletMsg('Solana wallet not found. Install Phantom or Solflare.'); setConnecting(false); return; }
      const resp = await provider.connect();
      const addr = resp.publicKey?.toString();
      if (addr) { await connectWallet('sol', addr); setWalletMsg(`Connected: ${addr.slice(0,6)}...${addr.slice(-4)}`); }
    } catch (e: any) { setWalletMsg(e.message || 'Connection rejected'); }
    setConnecting(false);
  };

  const connectEvm = async () => {
    setConnecting(true); setWalletMsg('');
    try {
      const eth = (window as any).ethereum;
      if (!eth) { setWalletMsg('EVM wallet not found. Install MetaMask.'); setConnecting(false); return; }
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts?.[0]) { await connectWallet('evm', accounts[0]); setWalletMsg(`Connected: ${accounts[0].slice(0,6)}...${accounts[0].slice(-4)}`); }
    } catch (e: any) { setWalletMsg(e.message || 'Connection rejected'); }
    setConnecting(false);
  };

  // Deposit
  const [asset, setAsset]   = useState<DepositAsset>('SOL');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [submitting, setSub]= useState(false);
  const [depositDone, setDepositDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const addr = DEPOSIT_ADDRESSES[asset];

  const handleCopy = () => {
    copyText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const submitDeposit = async () => {
    if (!amount || !txHash) return;
    setSub(true);
    await addDeposit(txHash, parseFloat(amount), asset, asset === 'SOL' ? 'Solana' : asset === 'BTC' ? 'Bitcoin' : 'EVM');
    setDepositDone(true);
    setSub(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-[min(92vw,420px)] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] sticky top-0 bg-[#0B0E14]">
          <span className="font-bold text-[#F4F6FA]">Wallet & Funds</span>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl transition-colors">×</button>
        </div>

        <div className="p-5">
          {/* Balance display */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] text-[#4B5563] mb-1">Mock Balance</p>
              <p className="text-lg font-bold text-[#F4F6FA]">${(account?.mock_balance ?? 0).toFixed(2)}</p>
              <p className="text-[10px] text-[#6B7280]">Paper trading</p>
            </div>
            <div className="rounded-xl border border-[#2BFFF1]/20 bg-[#2BFFF1]/05 p-3 text-center">
              <p className="text-[10px] text-[#4B5563] mb-1">Real Balance</p>
              <p className="text-lg font-bold text-[#2BFFF1]">${(account?.real_balance ?? 0).toFixed(2)}</p>
              <p className="text-[10px] text-[#6B7280]">Deposited funds</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl border border-white/[0.07] overflow-hidden mb-5">
            {([['wallet','Connect Wallet'],['deposit','Deposit Funds']] as const).map(([t,l]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-all ${tab === t ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'wallet' ? (
            <div className="space-y-3">
              {/* Connected wallets */}
              {account?.sol_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">Solana</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.sol_address}</p>
                  </div>
                </div>
              )}
              {account?.evm_address && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/05 px-3 py-2.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#6B7280]">EVM (ETH/BNB)</p>
                    <p className="text-xs text-[#F4F6FA] font-mono truncate">{account.evm_address}</p>
                  </div>
                </div>
              )}

              <button onClick={connectSol} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#9945FF]/30 bg-[#9945FF]/10 text-[#9945FF] text-sm font-semibold hover:bg-[#9945FF]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 40 40" fill="none">
                  <rect width="40" height="40" rx="11" fill="#4C44C6"/>
                  <path d="M10 20c0-5.5 4.5-10 10-10s10 4.5 10 10c0 3-1.3 5.7-3.4 7.6-1 .9-2 1.4-3.2 1.4h-.8c-.5 0-.8-.4-.8-.8v-.4c0-.5-.4-.8-.8-.8h-1.9c-.4 0-.8.3-.8.8v.4c0 .5-.4.8-.8.8h-.5C13.3 29 10 25 10 20z" fill="white"/>
                </svg>
                {account?.sol_address ? 'Reconnect Phantom / Solflare' : 'Connect Solana Wallet'}
              </button>

              <button onClick={connectEvm} disabled={connecting}
                className="w-full py-3 rounded-xl border border-[#F6851B]/30 bg-[#F6851B]/10 text-[#F6851B] text-sm font-semibold hover:bg-[#F6851B]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 40 40" fill="none">
                  <rect width="40" height="40" rx="11" fill="#1A1A1A"/>
                  <path d="M31.5 9L21.8 16.1l1.8-4.3L31.5 9z" fill="#E17726"/>
                  <path d="M8.5 9l9.6 7.2-1.7-4.3L8.5 9z" fill="#E27625"/>
                </svg>
                {account?.evm_address ? 'Reconnect MetaMask / EVM' : 'Connect MetaMask / EVM Wallet'}
              </button>

              {walletMsg && (
                <div className={`px-3 py-2.5 rounded-xl text-xs ${walletMsg.startsWith('Connected') ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {walletMsg}
                </div>
              )}

              <p className="text-[10px] text-[#374151] text-center pt-1">
                Connecting a wallet saves your address to your account for live trading mode.
              </p>
            </div>
          ) : depositDone ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-[#F4F6FA] font-bold mb-1">Deposit submitted</p>
              <p className="text-sm text-[#A7B0B7] mb-4">Your real balance has been updated. Funds will be verified on-chain.</p>
              <button onClick={() => setDepositDone(false)}
                className="px-4 py-2 rounded-xl text-xs text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/10 transition-all">
                Deposit more
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-[#A7B0B7]">
                Send funds to the address below, then paste your transaction hash to credit your account.
              </p>

              {/* Asset selector */}
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(DEPOSIT_ADDRESSES) as DepositAsset[]).map(a => (
                  <button key={a} onClick={() => setAsset(a)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${asset === a ? 'bg-[#2BFFF1]/15 border-[#2BFFF1]/40 text-[#2BFFF1]' : 'border-white/[0.08] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                    {a}
                  </button>
                ))}
              </div>

              {/* Address */}
              <div>
                <p className="text-[10px] text-[#6B7280] mb-1.5">Deposit address ({asset})</p>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#05060B] px-3 py-2.5">
                  <p className="font-mono text-xs text-[#A7B0B7] flex-1 break-all">{addr}</p>
                  <button onClick={handleCopy}
                    className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${copied ? 'text-green-400' : 'text-[#4B5563] hover:text-[#2BFFF1]'}`}>
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-[10px] text-[#6B7280] mb-1 block">Amount (USD value)</label>
                <input type="number" placeholder="e.g. 100" value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
              </div>

              {/* TX hash */}
              <div>
                <label className="text-[10px] text-[#6B7280] mb-1 block">Transaction Hash</label>
                <input placeholder="0x... or transaction signature" value={txHash} onChange={e => setTxHash(e.target.value)}
                  className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 font-mono" />
              </div>

              <button onClick={submitDeposit} disabled={submitting || !amount || !txHash}
                className="w-full py-3 rounded-xl font-bold text-sm bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                {submitting ? 'Submitting…' : 'Submit Deposit'}
              </button>

              <p className="text-[10px] text-[#374151] text-center">
                Minimum deposit $10. Deposits are credited pending on-chain verification.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
