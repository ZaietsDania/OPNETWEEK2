import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    encodeSelector,
    NetEvent,
    OP_NET,
    Revert,
    Selector,
    StoredAddress,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';

// ── Storage slot pointers (each must be unique per contract) ──────────────────
const POINTER_BTC_PRICE: u16   = 1;
const POINTER_LAST_BLOCK: u16  = 2;
const POINTER_OWNER: u16       = 3;

// ── Events ────────────────────────────────────────────────────────────────────

class PriceUpdatedEvent extends NetEvent {
    constructor(price: u256, blockNumber: u256) {
        const writer = new BytesWriter(64);
        writer.writeU256(price);
        writer.writeU256(blockNumber);
        super('PriceUpdated', writer);
    }
}

class OwnershipTransferredEvent extends NetEvent {
    constructor(previousOwner: Address, newOwner: Address) {
        const writer = new BytesWriter(64);
        writer.writeAddress(previousOwner);
        writer.writeAddress(newOwner);
        super('OwnershipTransferred', writer);
    }
}

// ── PriceOracle Contract ───────────────────────────────────────────────────────

export class PriceOracle extends OP_NET {
    // Persistent storage
    private readonly _btcPrice: StoredU256        = new StoredU256(POINTER_BTC_PRICE,  EMPTY_POINTER);
    private readonly _lastUpdatedBlock: StoredU256 = new StoredU256(POINTER_LAST_BLOCK, EMPTY_POINTER);
    private readonly _owner: StoredAddress         = new StoredAddress(POINTER_OWNER);

    // Method selectors
    private readonly SEL_GET_PRICE: Selector           = encodeSelector('getPrice()');
    private readonly SEL_SET_PRICE: Selector           = encodeSelector('setPrice(uint256)');
    private readonly SEL_GET_OWNER: Selector           = encodeSelector('owner()');
    private readonly SEL_TRANSFER_OWNERSHIP: Selector  = encodeSelector('transferOwnership(address)');

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public override onDeployment(_calldata: Calldata): void {
        const deployer: Address = this.contractDeployer;
        const zero: Address = Address.zero();

        this._owner.value = deployer;
        this.emitEvent(new OwnershipTransferredEvent(zero, deployer));
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        if (method == this.SEL_GET_PRICE) {
            return this._getPrice();
        } else if (method == this.SEL_SET_PRICE) {
            return this._setPrice(calldata);
        } else if (method == this.SEL_GET_OWNER) {
            return this._getOwner();
        } else if (method == this.SEL_TRANSFER_OWNERSHIP) {
            return this._transferOwnership(calldata);
        }

        return super.execute(method, calldata);
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * getPrice() → (price: u256, lastUpdatedBlock: u256)
     * Price is scaled ×10⁸ (e.g. $95,000.00 → 9500000000000).
     */
    private _getPrice(): BytesWriter {
        const writer = new BytesWriter(64);
        writer.writeU256(this._btcPrice.value);
        writer.writeU256(this._lastUpdatedBlock.value);
        return writer;
    }

    /**
     * owner() → address
     */
    private _getOwner(): BytesWriter {
        const writer = new BytesWriter(32);
        writer.writeAddress(this._owner.value);
        return writer;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * setPrice(price: uint256) → bool
     * Owner-only. Price must be scaled ×10⁸.
     */
    private _setPrice(calldata: Calldata): BytesWriter {
        this._requireOwner();

        const newPrice: u256 = calldata.readU256();
        if (u256.eq(newPrice, u256.Zero)) {
            throw new Revert('PriceOracle: price cannot be zero');
        }

        this._btcPrice.value = newPrice;

        const currentBlock: u256 = u256.fromU64(Blockchain.block.number);
        this._lastUpdatedBlock.value = currentBlock;

        this.emitEvent(new PriceUpdatedEvent(newPrice, currentBlock));

        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /**
     * transferOwnership(newOwner: address) → bool
     */
    private _transferOwnership(calldata: Calldata): BytesWriter {
        this._requireOwner();

        const newOwner: Address = calldata.readAddress();
        const previousOwner: Address = this._owner.value;

        this._owner.value = newOwner;
        this.emitEvent(new OwnershipTransferredEvent(previousOwner, newOwner));

        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _requireOwner(): void {
        const caller: Address = Blockchain.tx.sender;
        const owner: Address  = this._owner.value;

        if (caller != owner) {
            throw new Revert('PriceOracle: caller is not the owner');
        }
    }
}
