/**
 * Owner: R1. Task F-1: PaypalClient – internal typed errors.
 *
 * All errors are typed and NEVER contain secrets, tokens, or raw PayPal free text.
 */

export type PayPalErrorCode =
  | "OAUTH_FAILED"
  | "WINDOW_TOO_LARGE"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "TIMEOUT"
  | "INVALID_AMOUNT";

export class PayPalError extends Error {
  constructor(
    public readonly code: PayPalErrorCode,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}
