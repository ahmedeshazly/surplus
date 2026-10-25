/**
 * Owner: R1. Task F-1: packages/paypal/src/client – public exports.
 *
 * Only export what external consumers (R2, R4) need.
 * Internal types (raw PayPal API shapes) are NOT re-exported here to prevent
 * accidental use of free-text-carrying fields outside this package.
 */

export { PaypalClient } from "./PaypalClient.js";
export type { PayPalClientConfig, PayPalBalances, PayPalSafeDispute } from "./PaypalClient.js";

// Export raw transaction search response so R2's normalizer can reference it.
export type {
  PayPalTransactionSearchResponse,
  PayPalTransactionDetail,
  PayPalBalancesResponse,
} from "./PaypalClient.js";

export { PayPalError } from "./errors.js";
export type { PayPalErrorCode } from "./errors.js";
