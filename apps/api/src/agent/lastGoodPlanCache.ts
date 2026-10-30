import type { AllocationPlan, MerchantId } from "@surplus/contracts";
import { AllocationPlanSchema } from "@surplus/contracts";

export interface LastGoodPlanCache {
  get(merchantId: MerchantId): AllocationPlan | undefined;
  set(plan: AllocationPlan): void;
  clear(merchantId?: MerchantId): void;
}

function copyPlan(plan: AllocationPlan): AllocationPlan {
  return AllocationPlanSchema.parse(structuredClone(plan));
}

/** Small in-memory cache; persistence remains owned by R2's cached_plans data layer. */
export class InMemoryLastGoodPlanCache implements LastGoodPlanCache {
  readonly #plans = new Map<MerchantId, AllocationPlan>();

  get(merchantId: MerchantId): AllocationPlan | undefined {
    const plan = this.#plans.get(merchantId);
    return plan ? copyPlan(plan) : undefined;
  }

  set(plan: AllocationPlan): void {
    const validated = copyPlan(plan);
    this.#plans.set(validated.merchantId, validated);
  }

  clear(merchantId?: MerchantId): void {
    if (merchantId) {
      this.#plans.delete(merchantId);
      return;
    }
    this.#plans.clear();
  }
}

export const defaultLastGoodPlanCache = new InMemoryLastGoodPlanCache();
