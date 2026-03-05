/**
 * deploy.mjs — PriceOracle contract deployer for OP_NET
 *
 * Usage:
 *   1. Copy .env.example → .env and fill in WALLET_WIF, MLDSA_PRIVATE_KEY
 *   2. Fund the P2TR address (run wallet-gen.mjs to get it)
 *   3. node deploy.mjs
 *
 * The script will:
 *   • Fetch the current epoch challenge from the OP_NET node
 *   • Fetch your UTXOs
 *   • Build and sign both funding + reveal transactions
 *   • Broadcast them
 *   • Print your contract address
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networks } from '@btc-vision/bitcoin';
import { EcKeyPair, TransactionFactory, Wallet } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';

// ── Load .env manually (no dotenv dependency) ─────────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, '.env');

if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found. Copy .env.example → .env and fill in your keys.');
    process.exit(1);
}

const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => {
            const idx = l.indexOf('=');
            return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        }),
);

// ── Config ────────────────────────────────────────────────────────────────────
const WALLET_WIF      = env.WALLET_WIF;
const MLDSA_KEY       = env.MLDSA_PRIVATE_KEY;
const NETWORK_NAME    = (env.NETWORK ?? 'regtest').toLowerCase();
const RPC_URL         = env.RPC_URL ?? 'https://regtest.opnet.org';
const PRIORITY_FEE    = BigInt(env.PRIORITY_FEE ?? '10000');
const GAS_SAT_FEE     = 330n; // dust limit

if (!WALLET_WIF || !MLDSA_KEY) {
    console.error('ERROR: WALLET_WIF and MLDSA_PRIVATE_KEY must be set in .env');
    console.error('       Run:  node wallet-gen.mjs  to generate a fresh wallet');
    process.exit(1);
}

const network =
    NETWORK_NAME === 'mainnet' ? networks.bitcoin :
    NETWORK_NAME === 'testnet' ? networks.testnet :
                                 networks.regtest;

// ── Load WASM bytecode ────────────────────────────────────────────────────────
const wasmPath = path.join(__dir, 'build', 'PriceOracle.wasm');
if (!fs.existsSync(wasmPath)) {
    console.error('ERROR: build/PriceOracle.wasm not found. Run  npm run build  first.');
    process.exit(1);
}
const bytecode = fs.readFileSync(wasmPath);
console.log(`Bytecode loaded: ${bytecode.length} bytes  (${(bytecode.length / 1024).toFixed(1)} KB)`);

// ── Main ──────────────────────────────────────────────────────────────────────
async function deploy() {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  PriceOracle  →  OP_NET Deployment Script');
    console.log('══════════════════════════════════════════════');
    console.log(`  Network:  ${NETWORK_NAME}`);
    console.log(`  RPC:      ${RPC_URL}`);

    // 1. Provider
    const provider = new JSONRpcProvider(RPC_URL, network);

    // 2. Wallet
    const wallet = Wallet.fromWif(WALLET_WIF, MLDSA_KEY, network);
    console.log(`  Address:  ${wallet.p2tr}`);

    // 3. Check balance (OP_NET node may lag; we verified funds on mempool)
    const balance = await provider.getBalance(wallet.p2tr).catch(() => null);
    console.log(`  Balance:  ${balance !== null ? Number(balance) / 1e8 + ' BTC (' + balance + ' sat)' : 'unknown (node lag)'}`);

    // 4. Gas parameters
    console.log('');
    console.log('  Fetching gas parameters...');
    const gas = await provider.gasParameters();
    const feeRate = gas.bitcoin.recommended.medium;
    console.log(`  Fee rate: ${feeRate} sat/vB`);

    // 5. Epoch challenge
    console.log('  Fetching epoch challenge...');
    const challenge = await provider.getChallenge();
    console.log(`  Epoch:    #${challenge.epochNumber}`);

    // 6. Fetch UTXOs (fall back to mempool.space if OP_NET node lags)
    console.log('  Fetching UTXOs...');
    let utxos = await provider.utxoManager.getUTXOsForAmount({
        address: wallet.p2tr,
        amount: 100_000n,
    });
    console.log(`  UTXOs:    ${utxos.length} found via OP_NET`);

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
        console.log(`  UTXOs:    ${utxos.length} found via mempool.space`);
    }

    if (utxos.length === 0) {
        console.error('  ✗  No UTXOs found for address:', wallet.p2tr);
        process.exit(1);
    }

    // 7. Build & sign deployment
    console.log('');
    console.log('  Building deployment transaction...');
    const factory = new TransactionFactory();

    const deploymentParams = {
        signer:       wallet.keypair,
        mldsaSigner:  wallet.mldsaKeypair,
        network,
        bytecode:     Buffer.from(bytecode),
        feeRate,
        priorityFee:  PRIORITY_FEE,
        gasSatFee:    GAS_SAT_FEE,
        utxos,
        challenge,
    };

    const result = await factory.signDeployment(deploymentParams);

    console.log('  Transactions signed ✓');
    console.log(`  Contract address:  ${result.contractAddress}`);

    // 8. Broadcast via mempool.space testnet (OP_NET node may be out of sync)
    async function broadcastTx(rawHex, label) {
        const r = await fetch('https://mempool.space/testnet/api/tx', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: rawHex,
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`${label} broadcast failed: ${text}`);
        return text.trim(); // returns txid
    }

    console.log('');
    console.log('  Broadcasting funding transaction...');
    const fundingTxid = await broadcastTx(result.transaction[0], 'Funding');
    console.log(`  Funding tx:  ${fundingTxid}`);

    console.log('  Broadcasting reveal (deployment) transaction...');
    const revealTxid = await broadcastTx(result.transaction[1], 'Reveal');
    console.log(`  Reveal tx:   ${revealTxid}`);

    // 9. Save contract info to .env for set-price.mjs
    const contractHex = result.contractPubKey; // 32-byte hex prefixed with 0x
    let envContent = fs.readFileSync(envPath, 'utf8');
    // Update or append CONTRACT_ADDRESS
    if (envContent.includes('CONTRACT_ADDRESS=')) {
        envContent = envContent.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${result.contractAddress}`);
    } else {
        envContent += `\nCONTRACT_ADDRESS=${result.contractAddress}\n`;
    }
    // Update or append CONTRACT_HEX
    if (envContent.includes('CONTRACT_HEX=')) {
        envContent = envContent.replace(/CONTRACT_HEX=.*/g, `CONTRACT_HEX=${contractHex}`);
    } else {
        envContent += `CONTRACT_HEX=${contractHex}\n`;
    }
    fs.writeFileSync(envPath, envContent);

    // 10. Done
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  ✓  DEPLOYMENT SUCCESSFUL');
    console.log('══════════════════════════════════════════════');
    console.log('');
    console.log(`  Contract address:  ${result.contractAddress}`);
    console.log(`  Contract hex:      ${contractHex}`);
    console.log('');
    console.log('  Saved to contract/.env (CONTRACT_ADDRESS + CONTRACT_HEX)');
    console.log('');
    console.log('  Next steps:');
    console.log('  1. Add contract address to frontend/.env:');
    console.log(`       VITE_CONTRACT_ADDRESS=${result.contractAddress}`);
    console.log(`       VITE_OPNET_RPC_URL=${RPC_URL}`);
    console.log('  2. Run:  node set-price.mjs');
    console.log('  3. Restart the frontend:  npm run dev');
    console.log('');

    await provider.close?.().catch(() => {});
}

deploy().catch(err => {
    console.error('');
    console.error('  ✗  Deployment failed:', err.message ?? err);
    process.exit(1);
});
