/**
 * Owner: R1. Task F-1: PaypalClient – internal PayPal REST API types.
 *
 * These types are INTERNAL to this package. The normalizer (R2) maps them to
 * the shared @surplus/contracts types. Never export these from the package root.
 */

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
export interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
}

// ---------------------------------------------------------------------------
// Transaction Search  (GET /v1/reporting/transactions)
// ---------------------------------------------------------------------------
export interface PayPalTransactionAmountInfo {
  currency_code: string;
  value: string; // decimal string, e.g. "1200.00"
}

export interface PayPalFeeAmountInfo {
  currency_code: string;
  value: string;
}

export interface PayPalTransactionInfo {
  paypal_account_id?: string;
  transaction_id: string;
  paypal_reference_id?: string;
  paypal_reference_id_type?: string;
  transaction_event_code: string; // e.g. "T0006"
  transaction_initiation_date: string; // RFC3339
  transaction_updated_date: string;
  transaction_amount: PayPalTransactionAmountInfo;
  fee_amount?: PayPalFeeAmountInfo;
  transaction_status: string; // e.g. "S" (success)
  transaction_subject?: string; // FREE TEXT – strip immediately, never pass downstream
  transaction_note?: string; // FREE TEXT
  custom_field?: string; // FREE TEXT
}

export interface PayPalCartInfo {
  item_details?: Array<{
    item_quantity?: string;
    item_unit_price?: PayPalTransactionAmountInfo;
    item_amount?: PayPalTransactionAmountInfo;
    item_name?: string; // FREE TEXT – strip
  }>;
}

export interface PayPalPayerInfo {
  account_id?: string;
  email_address?: string; // PII – R2 normalizer hashes this; never logged
  payer_name?: {
    given_name?: string; // FREE TEXT / PII – strip
    surname?: string; // FREE TEXT / PII – strip
  };
}

export interface PayPalTransactionDetail {
  transaction_info: PayPalTransactionInfo;
  payer_info?: PayPalPayerInfo;
  cart_info?: PayPalCartInfo;
}

export interface PayPalTransactionSearchResponse {
  transaction_details: PayPalTransactionDetail[];
  account_number?: string;
  start_date: string;
  end_date: string;
  last_refreshed_datetime?: string;
  page: number;
  total_items: number;
  total_pages: number;
  links?: Array<{ href: string; rel: string; method: string }>;
}

// ---------------------------------------------------------------------------
// Balances  (GET /v1/reporting/balances)
// ---------------------------------------------------------------------------
export interface PayPalBalanceDetail {
  currency: string;
  primary: boolean;
  available_balance: {
    currency_code: string;
    value: string;
  };
  withheld_balance?: {
    currency_code: string;
    value: string;
  };
  total_balance: {
    currency_code: string;
    value: string;
  };
}

export interface PayPalBalancesResponse {
  balances: PayPalBalanceDetail[];
  account_id?: string;
  as_of_time: string;
  last_refresh_time?: string;
}

// ---------------------------------------------------------------------------
// Disputes  (GET /v1/customer/disputes)
// ---------------------------------------------------------------------------
export interface PayPalDisputeAmount {
  currency_code: string;
  value: string;
}

export interface PayPalDisputeItem {
  dispute_id: string;
  create_time: string;
  update_time?: string;
  disputed_transactions?: Array<{
    seller_transaction_id?: string;
    gross_amount?: PayPalDisputeAmount;
  }>;
  reason?: string; // structural code, not free text
  status: string; // e.g. "OPEN", "UNDER_REVIEW"
  dispute_amount: PayPalDisputeAmount;
  dispute_life_cycle_stage?: string;
  dispute_channel?: string;
  dispute_outcome?: { outcome_code?: string; amount_refunded?: PayPalDisputeAmount };
  links?: Array<{ href: string; rel: string; method: string }>;
  // NOTE: `messages`, `dispute_note`, `buyer_response_due_date` may contain FREE TEXT.
  // The client drops them entirely in the typed interface.
}

export interface PayPalDisputesResponse {
  items: PayPalDisputeItem[];
  links?: Array<{ href: string; rel: string; method: string }>;
}

// ---------------------------------------------------------------------------
// Webhook Signature Verification
// ---------------------------------------------------------------------------
export interface PayPalVerifyWebhookSignatureRequest {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
  webhook_id: string;
  webhook_event: unknown; // parsed JSON body
}

export interface PayPalVerifyWebhookSignatureResponse {
  verification_status: "SUCCESS" | "FAILURE";
}

// ---------------------------------------------------------------------------
// Orders v2  (POST /v2/checkout/orders, POST /v2/checkout/orders/{id}/capture)
// ---------------------------------------------------------------------------
export interface PayPalOrderResponse {
  id: string;
  status?: string;
  links?: Array<{ href: string; rel: string; method: string }>;
}

export interface PayPalOrderAmount {
  currency_code: string;
  value: string; // decimal string, e.g. "1200.00"
}

export interface PayPalCaptureItem {
  id: string;
  status: string;
  amount?: PayPalOrderAmount;
  create_time?: string;
  seller_receivable_breakdown?: {
    gross_amount?: PayPalOrderAmount;
    paypal_fee?: PayPalOrderAmount;
    net_amount?: PayPalOrderAmount;
  };
}

export interface PayPalCaptureResponse {
  id: string;
  status: string;
  payer?: {
    email_address?: string; // PII – hashed immediately in PayPalOrdersClient, never stored
  };
  purchase_units?: Array<{
    payments?: {
      captures?: PayPalCaptureItem[];
    };
  }>;
}
