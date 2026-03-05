/**
 * set-price.mjs — Push the current CoinGecko BTC spot price to the on-chain PriceOracle
 *
 * Usage:
 *   node set-price.mjs
 *
 * Reads wallet + network config from .env, fetches live BTC/USD from CoinGecko,
 * encodes and broadcasts a setPrice(uint256) interaction transaction.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networks } from '@btc-vision/bitcoin';
import { ABICoder, BinaryWriter, TransactionFactory, Wallet } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';

// ── Load .env ─────────────────────────────────────────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, '.env');
const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const WALLET_WIF       = env.WALLET_WIF;
const MLDSA_KEY        = env.MLDSA_PRIVATE_KEY;
const NETWORK_NAME     = (env.NETWORK ?? 'regtest').toLowerCase();
const RPC_URL          = env.RPC_URL ?? 'https://regtest.opnet.org';
const PRIORITY_FEE     = BigInt(env.PRIORITY_FEE ?? '10000');
const GAS_SAT_FEE      = 330n;

// Read contract address — contract/.env first, then frontend/.env
const frontendEnvPath = path.join(__dir, '..', 'frontend', '.env');
let CONTRACT_ADDRESS = env.CONTRACT_ADDRESS ?? '';
let CONTRACT_HEX     = env.CONTRACT_HEX ?? '';     // 32-byte hex saved by deploy.mjs
if (!CONTRACT_ADDRESS && fs.existsSync(frontendEnvPath)) {
    const fe = Object.fromEntries(
        fs.readFileSync(frontendEnvPath, 'utf8')
            .split('\n')
            .filter(l => l.trim() && !l.startsWith('#'))
            .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
    CONTRACT_ADDRESS = fe.VITE_CONTRACT_ADDRESS ?? '';
}

if (!CONTRACT_ADDRESS) {
    console.error('ERROR: Contract address not found. Set CONTRACT_ADDRESS in contract/.env');
    process.exit(1);
}

if (!CONTRACT_HEX) {
    console.error('ERROR: CONTRACT_HEX not found in contract/.env. Re-run node deploy.mjs first.');
    process.exit(1);
}

const network =
    NETWORK_NAME === 'mainnet' ? networks.bitcoin :
    NETWORK_NAME === 'testnet' ? networks.testnet :
                                 networks.regtest;

// ── Fetch BTC spot price from CoinGecko ───────────────────────────────────────
async function fetchBTCPrice() {
    const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data = await res.json();
    return data.bitcoin.usd;
}

// ── Build setPrice(uint256) calldata ─────────────────────────────────────────
function buildSetPriceCalldata(priceUsd) {
    const abi = new ABICoder();
    const selectorHex = abi.encodeSelector('setPrice(uint256)');
    const scaledPrice = BigInt(Math.round(priceUsd * 1e8));

    const writer = new BinaryWriter(36);
    // Selector: 4-byte little-endian u32
    writer.writeU32(parseInt(selectorHex, 16));
    // Argument: u256 (big-endian)
    writer.writeU256(scaledPrice);

    return Buffer.from(writer.getBuffer());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  PriceOracle  →  setPrice Interaction');
    console.log('══════════════════════════════════════════════');
    console.log(`  Network:   ${NETWORK_NAME}`);
    console.log(`  RPC:       ${RPC_URL}`);
    console.log(`  Contract:  ${CONTRACT_ADDRESS}`);

    // 1. Provider & wallet
    const provider = new JSONRpcProvider(RPC_URL, network);
    const wallet   = Wallet.fromWif(WALLET_WIF, MLDSA_KEY, network);
    console.log(`  Wallet:    ${wallet.p2tr}`);

    // 2. Fetch live BTC price
    console.log('');
    console.log('  Fetching BTC/USD spot price...');
    const priceUsd = await fetchBTCPrice();
    const scaledPrice = BigInt(Math.round(priceUsd * 1e8));
    console.log(`  BTC Price: $${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Scaled ×10⁸: ${scaledPrice.toLocaleString()}`);

    // 3. Gas + challenge + UTXOs
    console.log('');
    console.log('  Fetching gas parameters...');
    const gas     = await provider.gasParameters();
    const feeRate = gas.bitcoin.recommended.medium;
    console.log(`  Fee rate:  ${feeRate} sat/vB`);

    console.log('  Fetching epoch challenge...');
    const challenge = await provider.getChallenge();
    console.log(`  Epoch:     #${challenge.epochNumber}`);

    console.log('  Fetching UTXOs...');
    let utxos = await provider.utxoManager.getUTXOsForAmount({
        address: wallet.p2tr,
        amount:  100_000n,
    });
    console.log(`  UTXOs:     ${utxos.length} found via OP_NET`);

    if (utxos.length === 0) {
        console.log('  Falling back to mempool.space testnet...');
        const mRes = await fetch(`https://mempool.space/testnet/api/address/${wallet.p2tr}/utxo`);
        const mUtxos = await mRes.json();
        for (const u of mUtxos) {
            const txRes = await fetch(`https://mempool.space/testnet/api/tx/${u.txid}`);
            const tx = await txRes.json();
            const out = tx.vout[u.vout];
            utxos.push({
                transactionId: u.txid,
                outputIndex:   u.vout,
                value:         BigInt(u.value),
                scriptPubKey:  { hex: out.scriptpubkey, address: out.scriptpubkey_address },
            });
        }
        console.log(`  UTXOs:     ${utxos.length} found via mempool.space`);
    }

    if (utxos.length === 0) {
        console.error('  ✗  No UTXOs — fund the wallet and retry.');
        process.exit(1);
    }

    // 4. Use contract hex saved during deployment (avoids a getCode round-trip)
    const contractHex = CONTRACT_HEX;
    console.log(`  Contract hex: ${contractHex.slice(0, 18)}…`);

    // 5. Build & sign interaction
    console.log('');
    console.log('  Building setPrice transaction...');
    const calldata = buildSetPriceCalldata(priceUsd);
    const factory  = new TransactionFactory();

    const result = await factory.signInteraction({
        signer:      wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network,
        from:        wallet.p2tr,
        to:          CONTRACT_ADDRESS,
        contract:    contractHex,
        calldata,
        utxos,
        feeRate,
        priorityFee: PRIORITY_FEE,
        gasSatFee:   GAS_SAT_FEE,
        challenge,
    });

    console.log(`  Est. fees: ${result.estimatedFees.toLocaleString()} sat`);

    // 6 & 7. Broadcast via mempool.space testnet
    async function broadcastTx(rawHex, label) {
        const r = await fetch('https://mempool.space/testnet/api/tx', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: rawHex,
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`${label} broadcast failed: ${text}`);
        return text.trim();
    }

    if (result.fundingTransaction) {
        console.log('  Broadcasting funding transaction...');
        const ftxid = await broadcastTx(result.fundingTransaction, 'Funding');
        console.log(`  Funding tx:     ${ftxid}`);
    }

    console.log('  Broadcasting interaction transaction...');
    const itxid = await broadcastTx(result.interactionTransaction, 'Interaction');
    console.log(`  Interaction tx: ${itxid}`);

    // 8. Done
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  ✓  PRICE UPDATED ON-CHAIN');
    console.log('══════════════════════════════════════════════');
    console.log('');
    console.log(`  Value written: $${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
    console.log(`  Tx:            ${itxid}`);
    console.log('');

    await provider.close?.().catch(() => {});
}

main().catch(err => {
    console.error('');
    console.error('  ✗  Failed:', err.message ?? err);
    process.exit(1);
});
