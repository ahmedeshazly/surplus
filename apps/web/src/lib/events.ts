// Owner: R5. Presentation labels for SSE AppEvents. Event data itself always
// comes from the validated server payload; nothing here invents an update.
import type { AppEventType } from "@surplus/contracts";

export interface AppEventPresentation {
  label: string;
  shortLabel: string;
  tone: "positive" | "negative" | "neutral";
}

export function appEventPresentation(type: AppEventType): AppEventPresentation {
  switch (type) {
    case "payment.received":
      return { label: "Net Payment Received", shortLabel: "Payment", tone: "positive" };
    case "refund.processed":
      return { label: "Refund Processed", shortLabel: "Refund", tone: "negative" };
    case "dispute.opened":
      return { label: "Dispute Opened", shortLabel: "Dispute", tone: "negative" };
    case "plan.updated":
      return { label: "Plan Updated", shortLabel: "Plan", tone: "neutral" };
  }
}
