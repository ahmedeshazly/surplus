// Owner: R3 (exclusively). AGENT_CONTEXT.md Section 5: ratios round to 4 decimals (round4),
// bufferMonths round to 2 (round2). All money is non-negative integer cents, but if a tie
// reaches the rounding stage on a negative float, Math.round ties toward +infinity
// (Math.round(-0.375) = -0.37). Negative zero is normalized to plain zero so serialized
// output never contains -0.
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function round4(value: number): number {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

// Median of an unsorted numeric array. For an even count the two middle values are averaged
// and ties round half-up toward +infinity (integer-cents guarantee).
export function medianHalfUp(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  const left = sorted[mid] ?? 0;
  const right = sorted[Math.ceil((sorted.length - 1) / 2)] ?? left;
  return Math.round((left + right) / 2);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

// Sample standard deviation (denominator n-1). Fewer than two points give 0 instead of NaN.
export function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Ordinary least squares slope over index positions 0..n-1, rounded to 2 decimals, -0 -> 0.
export function linearSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const yMean = mean(values);
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i] ?? 0;
    num += (i - xMean) * (y - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return round2(num / den);
}
