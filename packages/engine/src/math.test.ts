// Owner: R3 (exclusively). Task H-7 groundwork: pure math unit tests for the engine's money
// (round-half-up, integer cents) and calendar month-bucket primitives.
import { describe, expect, it } from "vitest";
import {
  clamp,
  linearSlope,
  mean,
  medianHalfUp,
  round2,
  round4,
  sampleStdDev,
  sum,
} from "./rounding";
import {
  MS_PER_DAY,
  addDaysUtc,
  bucketFromIndex,
  bucketIndex,
  completedMonthBuckets,
  currentMonthStartUtc,
  isCompletedMonthRow,
  monthBucketOfDate,
  monthBucketOfIso,
  monthIndexOfDate,
  parseIsoUtc,
  toIsoUtc,
  trailingWindowUtc,
} from "./months";

describe("rounding", () => {
  it("rounds half up at exact binary-representable ties (Math.round: ties to +infinity)", () => {
    // 0.125 / 0.375 are exactly representable: positive ties go up, negative ties go toward +infinity.
    expect(round2(0.125)).toBe(0.13);
    expect(round2(0.375)).toBe(0.38);
    expect(round2(-0.375)).toBe(-0.37);
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(0.00004)).toBe(0.0);
    expect(round2(1.0)).toBe(1);
  });

  it("normalizes negative zero to positive zero", () => {
    expect(round2(-0)).toBe(0);
    expect(round2(-0.00001)).toBe(0);
    expect(Object.is(round2(-0), 0)).toBe(true);
    expect(Object.is(round4(-0), 0)).toBe(true);
    expect(Object.is(linearSlope([0, 0, 0]), 0)).toBe(true);
  });

  it("clamps", () => {
    expect(clamp(5, 3, 9)).toBe(5);
    expect(clamp(2, 3, 9)).toBe(3);
    expect(clamp(10, 3, 9)).toBe(9);
  });

  it("sums integer cents without precision loss", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
    expect(sum([121000, 205000])).toBe(326000);
  });

  it("medians: even sample averages the middle pair and rounds to integer cents", () => {
    expect(medianHalfUp([100, 200, 300])).toBe(200);
    expect(medianHalfUp([300, 100, 200])).toBe(200);
    expect(medianHalfUp([100, 101])).toBe(101); // average 100.5 rounds half-up
    expect(medianHalfUp([100, 101, 101, 101])).toBe(101);
    expect(medianHalfUp([])).toBe(0);
  });

  it("means", () => {
    expect(mean([3, 4])).toBe(3.5);
    expect(sampleStdDev([5])).toBe(0);
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
  });

  it("linear slope over n points", () => {
    expect(linearSlope([0, 100, 200])).toBe(100);
    expect(linearSlope([200, 200, 200])).toBe(0);
    expect(linearSlope([420000, 420000, 420000, 420000])).toBe(0);
  });
});

describe("months", () => {
  it("parses strict ISO-8601 UTC instants and rejects non-UTC", () => {
    expect(parseIsoUtc("2026-10-01T00:00:00Z").getTime()).toBe(1_790_812_800_000);
    expect(parseIsoUtc("2026-10-25T10:00:00Z").getTime()).toBe(Date.UTC(2026, 9, 25, 10));
    expect(parseIsoUtc("2026-10-25T10:00:00.000Z").getTime()).toBe(Date.UTC(2026, 9, 25, 10));
    expect(() => parseIsoUtc("2026-10-01T00:00:00+02:00")).toThrow();
    expect(() => parseIsoUtc("2026-10-01")).toThrow();
    expect(() => parseIsoUtc("not-a-date")).toThrow();
    expect(() => parseIsoUtc("2026-13-01T00:00:00Z")).toThrow();
  });

  it("rejects non-canonical month buckets", () => {
    expect(() => bucketIndex("202-07")).toThrow(/Invalid month bucket/);
    expect(() => bucketIndex("2026-00")).toThrow(/Invalid month bucket/);
    expect(() => bucketIndex("2026-13")).toThrow(/Invalid month bucket/);
    expect(() => bucketIndex("2026-xx")).toThrow(/Invalid month bucket/);
  });

  it("converts dates and instants to canonical month buckets", () => {
    expect(monthBucketOfIso("2026-10-01T00:00:00Z")).toBe("2026-10");
    expect(monthBucketOfIso("2025-12-31T23:59:59Z")).toBe("2025-12");
    expect(monthBucketOfDate(parseIsoUtc("2026-01-15T10:00:00Z"))).toBe("2026-01");
  });

  it("serializes to the canonical text form (drops milliseconds)", () => {
    expect(toIsoUtc(parseIsoUtc("2026-10-25T10:00:00Z"))).toBe("2026-10-25T10:00:00Z");
    expect(toIsoUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("2026-01-02T03:04:05Z");
  });

  it("round-trips bucket indices and both calendars agree", () => {
    expect(bucketIndex("2026-10")).toBe(2026 * 12 + 9);
    expect(bucketFromIndex(2026 * 12 + 9)).toBe("2026-10");
    expect(bucketFromIndex(0)).toBe("0000-01");
    for (let y = 1970; y <= 2075; y++) {
      for (let m = 1; m <= 12; m++) {
        const bucket = `${y}-${String(m).padStart(2, "0")}`;
        expect(bucketFromIndex(bucketIndex(bucket))).toBe(bucket);
        expect(monthIndexOfDate(new Date(Date.UTC(y, m - 1, 15)))).toBe(bucketIndex(bucket));
      }
    }
  });

  it("uses the first UTC instant of the current month", () => {
    expect(currentMonthStartUtc(parseIsoUtc("2026-10-25T10:00:00Z"))).toEqual(
      parseIsoUtc("2026-10-01T00:00:00Z"),
    );
    expect(currentMonthStartUtc(parseIsoUtc("2026-01-01T00:00:00Z"))).toEqual(
      parseIsoUtc("2026-01-01T00:00:00Z"),
    );
  });

  it("adds days across month boundaries with no DST surprises (UTC)", () => {
    expect(addDaysUtc(parseIsoUtc("2026-10-25T00:00:00Z"), -30)).toEqual(
      parseIsoUtc("2026-09-25T00:00:00Z"),
    );
    expect(addDaysUtc(parseIsoUtc("2026-09-30T00:00:00Z"), 1)).toEqual(
      parseIsoUtc("2026-10-01T00:00:00Z"),
    );
    expect(addDaysUtc(parseIsoUtc("2026-01-02T12:00:00Z"), -7)).toEqual(
      parseIsoUtc("2025-12-26T12:00:00Z"),
    );
  });

  it("computes trailing half-open windows [start, asOf)", () => {
    expect(trailingWindowUtc(parseIsoUtc("2026-10-25T10:00:00Z"), 7).start.toISOString()).toBe(
      "2026-10-18T10:00:00.000Z",
    );
    expect(trailingWindowUtc(parseIsoUtc("2026-10-25T10:00:00Z"), 7).end.getTime()).toBe(
      parseIsoUtc("2026-10-25T10:00:00Z").getTime(),
    );
    expect(trailingWindowUtc(parseIsoUtc("2026-10-01T00:00:00Z"), 90).start.toISOString()).toBe(
      "2026-07-03T00:00:00.000Z",
    );
  });

  it("zero-fills a contiguous completed-month span", () => {
    expect(
      completedMonthBuckets(
        ["2026-07", "2025-10", "2026-09", "2026-06"],
        parseIsoUtc("2026-10-01T00:00:00Z"),
      ),
    ).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(completedMonthBuckets(["2026-10"], parseIsoUtc("2026-10-25T00:00:00Z"))).toEqual([]);
    expect(completedMonthBuckets([], parseIsoUtc("2026-10-01T00:00:00Z"))).toEqual([]);
  });

  it("classifies rows as in-model or in-progress by month bucket only", () => {
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(isCompletedMonthRow("2026-09", parseIsoUtc("2026-10-01T00:00:00Z"))).toBe(true);
    expect(isCompletedMonthRow("2026-10", parseIsoUtc("2026-10-25T10:00:00Z"))).toBe(false);
    expect(isCompletedMonthRow("2026-10", parseIsoUtc("2026-10-01T00:00:00Z"))).toBe(false);
    expect(isCompletedMonthRow("2026-11", parseIsoUtc("2026-10-01T00:00:00Z"))).toBe(false);
  });
});
