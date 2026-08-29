// ── Xenia Wallet — Keystore ────────────────────────────────────────────────
//
// NON-CUSTODIAL CONTRACT
//   • The mnemonic and secret key are generated in the browser, from
//     crypto.getRandomValues. They are never sent anywhere.
//   • Only the PUBLIC address is ever written to Supabase.
//   • At rest the secret key exists only as AES-GCM ciphertext in IndexedDB,
//     unlockable by a password this app never transmits.
//   • There is no recovery path. If the user loses both the mnemonic and the
//     password, the funds are gone. That is the deal, and the UI must say so in
//     those words rather than softening it.
//
// WHAT THIS DOES NOT PROTECT AGAINST — read before shipping
//   A browser wallet that can sign unattended must hold the key in memory while
//   unlocked. Any script running on the page can read that memory. So:
//     - one XSS, one malicious dependency, one compromised CDN = drained wallet
//     - a browser extension with page access can read it too
//   Mitigations that actually work, in order of effect:
//     1. Fund the trading wallet with the disposable stake ONLY. Treat it as a
//        hot wallet you would be annoyed but not ruined to lose.
//     2. Serve with a strict CSP: no inline scripts, no third-party script tags
//        on any route that can unlock a vault. Pin dependency versions.
//     3. Auto-lock aggressively (see session.ts).
//     4. For manual trading, prefer a connected Phantom/Solflare wallet, where
//        the key never enters this page at all.
//   Do not tell users this is as safe as a hardware wallet. It is not.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';

const DB_NAME = 'xenia-vault';
const STORE = 'vaults';
const PBKDF2_ITERS = 600_000;        // OWASP 2023 floor for PBKDF2-SHA256
/** Phantom / Solflare default account path. Same seed → same address there. */
export const DERIVATION_PATH = "m/44'/501'/0'/0'";

export interface Vault {
  address: string;          // public key, base58 — the only field safe to sync
  label: string;
  createdAt: number;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;             // base64
  iv: string;               // base64
  ciphertext: string;       // base64, AES-GCM over the 64-byte secret key
  origin: 'generated' | 'imported';
  /** True once the user has proven they wrote the phrase down. */
  backupConfirmed: boolean;
}

// ── encoding helpers ───────────────────────────────────────────────────────

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (u: Uint8Array) =>
  Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

/**
 * WebCrypto wants a BufferSource backed by a plain ArrayBuffer. A Uint8Array
 * view over a pooled or shared buffer is not that, so copy into a fresh one.
 */
function bytes(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

/** Best-effort zeroing. JS gives no guarantee, but it shortens the window. */
export function wipe(...arrays: (Uint8Array | undefined)[]) {
  for (const a of arrays) if (a) a.fill(0);
}

// ── mnemonic → keypair ─────────────────────────────────────────────────────

/** 12 words (128 bits) matches Phantom's default. Pass 256 for 24 words. */
export function newMnemonic(strength: 128 | 256 = 128): string {
  return generateMnemonic(wordlist, strength);
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(phrase.trim().replace(/\s+/g, ' ').toLowerCase(), wordlist);
}

export function keypairFromMnemonic(phrase: string, path = DERIVATION_PATH): Keypair {
  const clean = phrase.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!validateMnemonic(clean, wordlist)) throw new Error('That recovery phrase is not valid.');
  const seed = mnemonicToSeedSync(clean);
  const { key } = derivePath(path, hex(new Uint8Array(seed)));
  const kp = Keypair.fromSeed(new Uint8Array(key));
  wipe(new Uint8Array(seed));
  return kp;
}

// ── vault encryption ───────────────────────────────────────────────────────

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', bytes(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytes(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createVault(
  kp: Keypair, password: string, label: string, origin: Vault['origin'],
): Promise<Vault> {
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytes(iv) }, key, bytes(kp.secretKey),
  ));
  return {
    address: kp.publicKey.toBase58(),
    label,
    createdAt: Date.now(),
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERS,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ct),
    origin,
    backupConfirmed: false,
  };
}

export async function unlockVault(vault: Vault, password: string): Promise<Keypair> {
  const key = await deriveAesKey(password, unb64(vault.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(unb64(vault.iv)) }, key, bytes(unb64(vault.ciphertext)),
    );
  } catch {
    // AES-GCM auth failure is indistinguishable from a wrong password, which is
    // what we want — do not leak which one it was.
    throw new Error('Wrong password.');
  }
  const secret = new Uint8Array(plain);
  const kp = Keypair.fromSecretKey(secret);
  wipe(secret);
  if (kp.publicKey.toBase58() !== vault.address) {
    throw new Error('Vault is corrupt: decrypted key does not match the stored address.');
  }
  return kp;
}

// ── IndexedDB storage ──────────────────────────────────────────────────────
// IndexedDB rather than localStorage: it is not exposed to synchronous
// same-origin reads from every script, and it survives larger payloads. Neither
// is a security boundary against XSS — see the header.

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) {
        r.result.createObjectStore(STORE, { keyPath: 'address' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

export const saveVault = (v: Vault) => tx('readwrite', s => s.put(v));
export const listVaults = () => tx<Vault[]>('readonly', s => s.getAll());
export const getVault = (address: string) => tx<Vault | undefined>('readonly', s => s.get(address));
export const deleteVault = (address: string) => tx('readwrite', s => s.delete(address));

// ── backup verification ────────────────────────────────────────────────────

/**
 * Pick word positions to quiz the user on. Verifying the phrase before letting
 * them fund the wallet is the difference between "non-custodial" and "lost".
 */
export function backupChallenge(mnemonic: string, count = 3): number[] {
  const n = mnemonic.trim().split(/\s+/).length;
  const picks = new Set<number>();
  const buf = new Uint32Array(count * 4);
  crypto.getRandomValues(buf);
  let i = 0;
  while (picks.size < count && i < buf.length) picks.add((buf[i++] % n) + 1);
  return [...picks].sort((a, b) => a - b);
}

export function checkBackup(mnemonic: string, answers: Record<number, string>): boolean {
  const words = mnemonic.trim().split(/\s+/);
  return Object.entries(answers).every(
    ([pos, word]) => words[Number(pos) - 1] === word.trim().toLowerCase(),
  );
}
