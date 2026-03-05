/**
 * OP_NET Contract Service
 *
 * Read   → btc_call JSON-RPC via OPNetLimitedProvider
 * Write  → Manual UTXO injection (mempool.space) + signInteraction
 *           → fallback: signAndBroadcastInteraction with feeRate 100
 */
import {
    ABICoder,
    BinaryReader,
    BinaryWriter,
    OPNetLimitedProvider,
    type UTXO,
    type OPWallet,
} from '@btc-vision/transaction';
import { networks, fromBech32, toBech32 } from '@btc-vision/bitcoin';

declare global {
    interface Window { opnet?: OPWallet; }
}

// ── Config ────────────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS: string = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';
export const CONTRACT_HEX:     string = import.meta.env.VITE_CONTRACT_HEX     ?? '';
export const RPC_URL:          string = import.meta.env.VITE_OPNET_RPC_URL    ?? 'https://regtest.opnet.org';

const IS_TESTNET  = RPC_URL.includes('testnet') || RPC_URL.includes('regtest');
const MEMPOOL_BASE = IS_TESTNET ? 'https://mempool.space/testnet' : 'https://mempool.space';

const abi = new ABICoder();

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OraclePrice {
    rawPrice: bigint;
    usd: number;
    lastUpdatedBlock: bigint;
}

// ── Provider ──────────────────────────────────────────────────────────────────
let _provider: OPNetLimitedProvider | null = null;
function getProvider() {
    if (!_provider) _provider = new OPNetLimitedProvider(RPC_URL);
    return _provider;
}

// ── btc_call ──────────────────────────────────────────────────────────────────
interface BtcCallResult { result?: string; revert?: string; error?: string; }

async function btcCall(contractAddress: string, calldataHex: string): Promise<Uint8Array> {
    let raw: BtcCallResult;
    try {
        raw = await getProvider().rpcMethod('btc_call', [
            contractAddress, calldataHex,
            undefined, undefined, undefined, undefined, undefined,
        ]) as BtcCallResult;
    } catch (e) { throw new Error((e as Error).message ?? 'btc_call RPC error'); }
    if (raw.error)   throw new Error(raw.error);
    if (raw.revert)  throw new Error(`Contract reverted: ${raw.revert}`);
    if (!raw.result) throw new Error('btc_call returned empty result');
    return Uint8Array.from(atob(raw.result), c => c.charCodeAt(0));
}

// ── Address: opt1… → tb1… ────────────────────────────────────────────────────
function toStandardAddress(address: string): string {
    try {
        const { version, data } = fromBech32(address);
        const standard = toBech32(data, version, IS_TESTNET ? 'tb' : 'bc');
        console.log('[toStandardAddress]', address, '→', standard);
        return standard;
    } catch { return address; }
}

// ── UTXO fetch (confirmed only, opt1→tb1 for API call) ───────────────────────
interface MempoolUTXO {
    txid: string; vout: number; value: number;
    status: { confirmed: boolean; block_height?: number };
}

async function fetchUTXOs(opnetAddress: string): Promise<UTXO[]> {
    const tb1Address = toStandardAddress(opnetAddress);
    console.log('[fetchUTXOs] checking mempool.space for:', tb1Address);
    console.log('[fetchUTXOs] mempool link →', `${MEMPOOL_BASE}/address/${tb1Address}`);

    const res = await fetch(`${MEMPOOL_BASE}/api/address/${tb1Address}/utxo`);
    if (!res.ok) throw new Error(`mempool UTXO fetch failed: ${res.status}`);

    const all: MempoolUTXO[] = await res.json();
    const confirmed = all.filter(u => u.status.confirmed);
    console.log(`[fetchUTXOs] total: ${all.length}  confirmed: ${confirmed.length}`);

    if (confirmed.length === 0) {
        throw new Error(
            `No confirmed UTXOs at ${tb1Address} — ` +
            `${all.length} unconfirmed. Wait for next block or send fresh tBTC.`
        );
    }

    const result: UTXO[] = [];
    for (const u of confirmed) {
        const txRes = await fetch(`${MEMPOOL_BASE}/api/tx/${u.txid}`);
        if (!txRes.ok) { console.warn('[fetchUTXOs] skip (tx fetch failed):', u.txid); continue; }
        const tx   = await txRes.json();
        const vout = tx.vout[u.vout];
        result.push({
            transactionId: u.txid,
            outputIndex:   u.vout,
            value:         BigInt(u.value),
            scriptPubKey:  { hex: vout.scriptpubkey, address: vout.scriptpubkey_address },
        });
        console.log(`[fetchUTXOs] ✓ ${u.txid}:${u.vout}  ${u.value} sat  block ${u.status.block_height}`);
    }

    if (result.length === 0) throw new Error('All confirmed UTXO detail fetches failed');
    return result;
}

// ── Broadcast raw tx hex to mempool.space ────────────────────────────────────
async function broadcastToMempool(rawHex: string, label: string): Promise<string> {
    const res = await fetch(`${MEMPOOL_BASE}/api/tx`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: rawHex,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} broadcast failed (${res.status}): ${text}`);
    console.log(`✅ ${label} TXID:`, text.trim());
    return text.trim();
}

// ── Public: read oracle ───────────────────────────────────────────────────────
export async function readOraclePrice(): Promise<OraclePrice | null> {
    if (!CONTRACT_ADDRESS) return null;
    const selectorHex = abi.encodeSelector('getPrice()');
    const w = new BinaryWriter(4);
    w.writeU32(parseInt(selectorHex, 16));
    const calldataHex = Array.from(new Uint8Array(w.getBuffer()))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    const bytes = await btcCall(CONTRACT_ADDRESS, calldataHex);
    const r = new BinaryReader(bytes);
    const rawPrice = r.readU256();
    const lastUpdatedBlock = r.readU256();
    return { rawPrice, usd: Number(rawPrice) / 1e8, lastUpdatedBlock };
}

// ── Public: push price ───────────────────────────────────────────────────────
export async function pushOraclePrice(usdPrice: number): Promise<string> {
    const opnet = window.opnet;
    if (!opnet) { alert('OP Wallet not found!'); throw new Error('OP Wallet not found'); }
    if (!CONTRACT_ADDRESS) throw new Error('VITE_CONTRACT_ADDRESS not set');
    if (!CONTRACT_HEX)     throw new Error('VITE_CONTRACT_HEX not set');

    // 1. Connect
    const accounts = await opnet.requestAccounts();
    if (!accounts?.length) throw new Error('No accounts in OP Wallet');
    console.log('[pushOraclePrice] account (opt1):', accounts[0]);

    // 2. Fetch confirmed UTXOs
    const utxos = await fetchUTXOs(accounts[0]);
    console.log('[pushOraclePrice] UTXOs ready:', utxos.length);

    // 3. Build calldata
    const selectorHex = abi.encodeSelector('setPrice(uint256)');
    const w = new BinaryWriter(4 + 32);
    w.writeU32(parseInt(selectorHex, 16));
    w.writeU256(BigInt(Math.round(usdPrice * 1e8)));
    const calldata = Buffer.from(w.getBuffer());
    console.log('[pushOraclePrice] calldata:', calldata.toString('hex'));

    const network = IS_TESTNET ? networks.testnet : networks.bitcoin;
    const baseParams = {
        to:          CONTRACT_ADDRESS,
        contract:    CONTRACT_HEX,
        calldata,
        utxos,
        from:        accounts[0],
        priorityFee: 10_000n,
        gasSatFee:   10_000n,
        network,
    };

    // 4a. Primary path: sign locally → broadcast to mempool.space
    try {
        console.log('[pushOraclePrice] trying signInteraction + manual broadcast …');
        const signed = await opnet.web3.signInteraction({ ...baseParams, feeRate: 100 });
        console.log('[pushOraclePrice] signed:', signed);

        let fundingTxid = '';
        if (signed.fundingTransaction) {
            fundingTxid = await broadcastToMempool(signed.fundingTransaction, 'FUNDING');
        }
        const interactionTxid = await broadcastToMempool(signed.interactionTransaction, 'INTERACTION');
        console.log('✅ FUNDING     TXID:', fundingTxid || '(none)');
        console.log('✅ INTERACTION TXID:', interactionTxid);
        return interactionTxid || fundingTxid;

    } catch (signErr) {
        console.warn('[pushOraclePrice] signInteraction failed:', (signErr as Error).message);
        console.warn('[pushOraclePrice] falling back to signAndBroadcastInteraction feeRate=100 …');
    }

    // 4b. Fallback: let wallet sign AND broadcast
    const [fundingTx, interactionTx] = await opnet.web3.signAndBroadcastInteraction({
        ...baseParams, feeRate: 100,
    });

    const fundingTxid     = fundingTx.result    ?? '(none)';
    const interactionTxid = interactionTx.result ?? '(none)';
    console.log('✅ FUNDING     TXID:', fundingTxid);
    console.log('✅ INTERACTION TXID:', interactionTxid);

    if (!interactionTx.success) {
        throw new Error(`Broadcast failed: ${interactionTx.error ?? 'unknown'}`);
    }
    return interactionTxid !== '(none)' ? interactionTxid : fundingTxid;
}
