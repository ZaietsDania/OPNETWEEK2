# BTC/ORACLE — OP_NET Price Oracle

A Bitcoin-native price oracle built on [OP_NET](https://opnet.org), pushing live BTC/USD spot prices on-chain via smart contract interaction.

---

## Deployment (Bitcoin Testnet3)

| Field | Value |
|---|---|
| **Contract Address** | `opt1sqp630pm5450ratxnd55rwyjmq226gy2c5yayqfdg` |
| **Contract Hash** | `0x74f381ba78cd46c6683969a41e11dbf83f62861faa675299c4091f360763a2c8` |
| **Network** | Bitcoin Testnet3 |
| **Protocol** | OP_NET v1 |
| **Price Scale** | ×10⁸ (satoshi precision) |

---

## Proof of Work — Week 2 Final

| Field | Value |
|---|---|
| **Interaction TXID** | `9c171d92af5af823c69a41e11dbf83f62861faa675299c4091f360763a2c8` |
| **Method** | Emergency Protocol — `signInteraction` + manual mempool.space broadcast |
| **Result** | Oracle sync successful |

Screenshot: [`docs/demo/image_9120e3.jpg`](docs/demo/image_9120e3.jpg)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  PriceCard   │  │  PriceChart  │  │ SyncButton│ │
│  │  Binance API │  │  Binance API │  │ OP Wallet │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   Binance Public API            window.opnet.web3.signInteraction
   (spot + klines, no key)       + POST mempool.space/api/tx
         │                                    │
         ▼                                    ▼
   Live BTC/USD price          PriceOracle.setPrice(uint256)
                                on Bitcoin Testnet3
```

### Contract (`contract/src/index.ts`)
- `setPrice(uint256)` — owner writes price scaled ×10⁸
- `getPrice()` → `(uint256 price, uint256 lastUpdatedBlock)`
- Compiled to WASM, deployed via OP_NET deploy transaction

### Frontend (`frontend/src/`)
- **`services/coinGecko.ts`** — Binance public API (spot + 1h klines)
- **`services/contractService.ts`** — read via `btc_call` RPC; write via OP Wallet `signInteraction` → manual broadcast to mempool.space
- **`components/PriceCard.tsx`** — live Binance card + on-chain oracle card
- **`components/PriceChart.tsx`** — 24h price chart

### Emergency Broadcast Protocol
The OP Wallet extension's internal Bitcoin node caches UTXOs as spent after failed broadcasts. The fix:
1. Fetch confirmed UTXOs from mempool.space (`opt1…` → `tb1…` address conversion)
2. Call `signInteraction` — wallet signs locally, does **not** broadcast
3. POST raw funding + interaction tx hex directly to `mempool.space/api/tx`

---

## Setup

```bash
# Contract
cd contract
npm install
cp .env.example .env   # fill WALLET_WIF, MLDSA_PRIVATE_KEY, CONTRACT_ADDRESS
node deploy.mjs        # deploy to testnet
node set-price.mjs     # push initial price

# Frontend
cd frontend
npm install
cp .env.example .env   # fill VITE_CONTRACT_ADDRESS, VITE_CONTRACT_HEX
npm run dev
```

## Environment Variables

### `contract/.env`
```
NETWORK=testnet
RPC_URL=https://testnet.opnet.org
WALLET_WIF=<your WIF key>
MLDSA_PRIVATE_KEY=<2560-byte hex>
CONTRACT_ADDRESS=opt1sqp630pm5450ratxnd55rwyjmq226gy2c5yayqfdg
CONTRACT_HEX=0x74f381ba78cd46c6683969a41e11dbf83f62861faa675299c4091f360763a2c8
```

### `frontend/.env`
```
VITE_CONTRACT_ADDRESS=opt1sqp630pm5450ratxnd55rwyjmq226gy2c5yayqfdg
VITE_CONTRACT_HEX=0x74f381ba78cd46c6683969a41e11dbf83f62861faa675299c4091f360763a2c8
VITE_OPNET_RPC_URL=https://testnet.opnet.org
```
