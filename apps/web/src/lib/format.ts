// Owner: R5. Display-only formatting. Money never gets calculated here: every
// value arrives from @surplus/contracts as signed integer cents and is formatted
// for the screen only.
import type { TransactionKind } from "@surplus/contracts";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}

/** Compact axis label, e.g. 202000 -> "$2K". Display only. */
export function formatCompactCents(cents: number): string {
  return USD_COMPACT.format(cents / 100);
}

export function formatSignedCents(cents: number): string {
  if (cents === 0) return formatCents(0);
  const absolute = formatCents(Math.abs(cents));
  return `${cents > 0 ? "+" : "-"}${absolute}`;
}

/** Formats a 0..1 ratio as a percentage, e.g. 0.2503 -> "25.03%". */
export function formatRatioPercent(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Formats a 0..1 ratio as a decimal, e.g. 0.2503 -> "0.2503". */
export function formatDecimal(value: number, digits = 4): string {
  return value.toFixed(digits);
}

/** Formats an already-percentage integer, e.g. 30 -> "30%". */
export function formatWholePercent(value: number): string {
  return `${value}%`;
}

export function formatMonths(months: number): string {
  return `${months.toFixed(2)} months`;
}

export function formatMonthBucket(bucket: string): string {
  const parts = bucket.split("-");
  const year = parts[0];
  const monthIndex = Number(parts[1]) - 1;
  const month = SHORT_MONTHS[monthIndex];
  if (year === undefined || month === undefined) return bucket;
  return `${month} ${year}`;
}

/** Compact chart axis label, e.g. "2026-09" -> "Sep '26". */
export function formatMonthBucketShort(bucket: string): string {
  const parts = bucket.split("-");
  const year = parts[0];
  const monthIndex = Number(parts[1]) - 1;
  const month = SHORT_MONTHS[monthIndex];
  if (year === undefined || month === undefined) return bucket;
  return `${month} '${year.slice(2)}`;
}

export function formatIsoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_ONLY.format(date);
}

export function formatIsoDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_TIME.format(date);
}

export function formatWindowRange(startIso: string, endIso: string): string {
  return `${formatIsoDate(startIso)} – ${formatIsoDate(endIso)}`;
}

/** Renders a whole number of cents as a plain dollars-and-cents input string. */
export function centsToDollarInput(cents: number): string {
  const safe = Math.max(0, Math.trunc(cents));
  const dollars = Math.floor(safe / 100);
  const remainder = safe % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Parses a user-entered dollar amount into integer cents without floating point
 * arithmetic. Returns null when the value is malformed or not a safe integer.
 */
export function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) return null;
  const dollars = Number(match[1] ?? "0");
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

const KIND_LABELS: Record<TransactionKind, string> = {
  income: "Income",
  refund: "Refund",
  chargeback: "Chargeback",
  fee: "Fee",
  withdrawal: "Withdrawal",
  other: "Other",
};

export function formatTransactionKind(kind: TransactionKind): string {
  return KIND_LABELS[kind];
}

export function formatToolName(toolName: string): string {
  const labels: Record<string, string> = {
    get_cash_flow_summary: "Cash-flow summary",
    get_surplus: "Surplus calculation",
    get_allocation_plan: "Allocation plan",
    run_scenario: "Scenario comparison",
    paypal_mcp_list_transactions: "PayPal MCP · transactions",
    paypal_mcp_list_disputes: "PayPal MCP · disputes",
  };
  return labels[toolName] ?? toolName.replaceAll("_", " ");
}

export function humanizeCode(code: string): string {
  const spaced = code.replaceAll("_", " ").trim();
  if (spaced.length === 0) return code;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
