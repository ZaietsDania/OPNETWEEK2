# BTC Price Oracle — OP_NET

A Bitcoin-native price oracle built on OP_NET smart contracts. Reads live BTC/USD spot price from Binance and pushes it on-chain via a deployed OP_NET contract. Frontend is a cyberpunk fintech dashboard built with React + Vite + TypeScript.

## Proof of Work — Week 2: Oracle Sync Successful

![Oracle Sync Screenshot](docs/demo/image_8291e2.jpg)

The screenshot above shows the BTC/USD price successfully synced from Binance spot to the on-chain OP_NET PriceOracle contract, with the transaction broadcast confirmed via mempool.space.

## Project Structure

```
/contract    — OP_NET smart contract (AssemblyScript)
/frontend    — Cyberpunk UI dashboard (React + Vite + TypeScript)
/docs/demo   — Screenshots and proof of work
```

## Frontend — Quick Start

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Features

- Live BTC/USD spot price via Binance public API (no key required)
- 24-hour price chart with neon SVG rendering
- One-click oracle sync — pushes price on-chain via OP Wallet
- Cyberpunk fintech UI with Orbitron + Share Tech Mono fonts
- Auto-refresh every 30s, oracle retry every 15s

## Stack

| Layer    | Tech                              |
|----------|-----------------------------------|
| Contract | OP_NET / AssemblyScript           |
| Frontend | React 18, Vite 5, TypeScript 5    |
| Wallet   | OP Wallet (`window.opnet`)        |
| Price    | Binance REST API                  |
| Network  | Bitcoin Mainnet / OP_NET          |
