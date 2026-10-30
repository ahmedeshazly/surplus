import { exampleAllocationPlan } from "@surplus/contracts/examples";
import { describe, expect, it } from "vitest";
import { InMemoryLastGoodPlanCache } from "./lastGoodPlanCache.js";

describe("InMemoryLastGoodPlanCache", () => {
  it("stores the most recent contract-valid plan per merchant", () => {
    const cache = new InMemoryLastGoodPlanCache();
    cache.set(exampleAllocationPlan);
    expect(cache.get(exampleAllocationPlan.merchantId)).toEqual(exampleAllocationPlan);
  });

  it("returns defensive copies so callers cannot corrupt the cached plan", () => {
    const cache = new InMemoryLastGoodPlanCache();
    cache.set(exampleAllocationPlan);
    const first = cache.get(exampleAllocationPlan.merchantId);
    if (!first) throw new Error("expected cached plan");
    first.bands[0]!.label = "mutated";
    expect(cache.get(exampleAllocationPlan.merchantId)?.bands[0]?.label).not.toBe("mutated");
  });

  it("can clear one merchant or the complete cache", () => {
    const cache = new InMemoryLastGoodPlanCache();
    cache.set(exampleAllocationPlan);
    cache.clear(exampleAllocationPlan.merchantId);
    expect(cache.get(exampleAllocationPlan.merchantId)).toBeUndefined();
    cache.set(exampleAllocationPlan);
    cache.clear();
    expect(cache.get(exampleAllocationPlan.merchantId)).toBeUndefined();
  });
});
