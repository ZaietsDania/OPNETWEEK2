/**
 * OP_NET Contract Factory Entry Point
 *
 * This file is the WASM module entry point.
 * OP_NET's runtime discovers the contract by the exported `Contract` symbol.
 */
import { PriceOracle } from './contracts/PriceOracle';

export { PriceOracle as Contract };

// Re-export the class so the runtime can instantiate it
export function createContract(): PriceOracle {
    return new PriceOracle();
}
