# Xenia Trading Platform - Claude Instructions

## Project Overview
Solana-focused live trading platform with spot/leverage trading, bots, copy trading, wallet management, and real-time charts. Goal: production-ready for real funds.

## Core Rules (Always Follow)
- Live on-chain SOL balance is the single source of truth (address: 53NooDTuHXiiCesVgn87rZ76hRYa2GZj4gepSAPRxbAX when applicable).
- Use @solana/web3.js Connection.getBalance() + onAccountChange WebSocket for real-time balance updates.
- Deposit flow must be simple: show wallet address + QR, auto-detect incoming deposits, instant UI update.
- Safety first: ALWAYS show clear confirmation dialog + risk warning before any real trade, withdrawal, or transfer.
- Mock mode must never execute real on-chain actions.
- Field names must be consistent: use `platform_wallet_address` and `deposit_wallets.sol`.

## Tech Stack & Preferences
- React + Vite + TypeScript + Tailwind
- Supabase for auth and database
- @solana/web3.js for on-chain operations
- Keep code clean, functional, and secure

## Response Style (Strict)
- Be extremely concise.
- Output ONLY diffs, short bullets, or PLAN when asked.
- Never add explanations, greetings, or long summaries unless explicitly requested.
- Max 100 tokens per reply unless I say otherwise.

## Safety & Production Rules
- Prioritize security and error handling for real funds.
- Add proper validation and user confirmations on money-related actions.
- Test flows must work for both mock and live modes.

Keep all changes focused and production-ready.
