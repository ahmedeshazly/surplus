// Owner: R3 (exclusively). All calendar math is UTC (PayPal timestamps are ISO-8601 UTC "Z").
// The engine never reads the clock: every Date is derived from caller-supplied input strings.
export const MS_PER_DAY = 86_400_000;

// Strict ISO-8601 UTC instant ("YYYY-MM-DDTHH:MM:SS[.SSS]Z") — no timezone offsets, no
// date-only strings. Parsing must be deterministic: every consumed timestamp in this engine
// is a normalized, machine-generated string.
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function parseIsoUtc(iso: string): Date {
  if (!ISO_UTC_PATTERN.test(iso)) {
    throw new Error(`Invalid ISO-8601 UTC date: '${iso}'`);
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO-8601 UTC date: '${iso}'`);
  }
  return date;
}

export function toIsoUtc(date: Date): string {
  const full = date.toISOString();
  return full.endsWith(".000Z") ? full.slice(0, full.length - 5) + "Z" : full;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// "YYYY-MM" from an ISO UTC instant, strictly by UTC calendar parts.
export function monthBucketOfIso(iso: string): string {
  const d = parseIsoUtc(iso);
  return monthBucketOfDate(d);
}

export function monthBucketOfDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

// Monotonic integer key for a bucket: year * 12 + (month - 1).
export function bucketIndex(bucket: string): number {
  const year = Number(bucket.slice(0, 4));
  const month = Number(bucket.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month bucket: '${bucket}'`);
  }
  return year * 12 + (month - 1);
}

export function bucketFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${pad2(month)}`;
}

export function monthIndexOfDate(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

// Start of the calendar month bucket containing `date`: the end boundary of the last
// completed month and the start of the current in-progress month.
export function currentMonthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// Half-open trailing window [asOf - days, asOf).
export function trailingWindowUtc(asOf: Date, days: number): { start: Date; end: Date } {
  return { start: addDaysUtc(asOf, -days), end: new Date(asOf.getTime()) };
}

// The contiguous completed-month span: zero-filled month buckets from the earliest to the
// latest month that HAS completed transactions (strictly before the month containing asOf).
// Intermediate months with no completed rows count as true zero months. Future months cannot
// extend the span: any bucket at or after the in-progress month is defensively ignored.
export function completedMonthBuckets(completedBuckets: readonly string[], asOf: Date): string[] {
  if (completedBuckets.length === 0) return [];
  const partialStartIndex = monthIndexOfDate(currentMonthStartUtc(asOf));
  let minIndex = Number.POSITIVE_INFINITY;
  let maxIndex = Number.NEGATIVE_INFINITY;
  for (const bucket of completedBuckets) {
    const idx = bucketIndex(bucket);
    if (idx < partialStartIndex) {
      if (idx < minIndex) minIndex = idx;
      if (idx > maxIndex) maxIndex = idx;
    }
  }
  if (!Number.isFinite(minIndex) || minIndex > maxIndex) return [];
  const out: string[] = [];
  for (let idx = minIndex; idx <= maxIndex; idx++) {
    out.push(bucketFromIndex(idx));
  }
  return out;
}

// A transaction is a completed-calendar-month row when its month bucket is strictly before the
// in-progress month of asOf.
export function isCompletedMonthRow(bucket: string, asOf: Date): boolean {
  return bucketIndex(bucket) < monthIndexOfDate(currentMonthStartUtc(asOf));
}
