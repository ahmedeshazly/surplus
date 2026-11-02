"use client";

// Owner: R5. Live SSE toast. It only renders a validated AppEvent that actually
// arrived on /api/events; the dashboard never fabricates a payment or update.
import type { AppEvent } from "@surplus/contracts";
import { appEventPresentation } from "@/lib/events";
import { formatIsoDateTime, formatSignedCents } from "@/lib/format";

interface LiveEventToastProps {
  event: AppEvent;
  onDismiss: () => void;
}

export function LiveEventToast({ event, onDismiss }: LiveEventToastProps) {
  const copy = appEventPresentation(event.type);
  const showDelta = event.type !== "plan.updated";

  return (
    <div className={`event-toast event-toast--${copy.tone}`} role="status" aria-live="polite">
      <span className="event-toast-bar" aria-hidden="true" />
      <div className="event-toast-body">
        <div className="event-toast-head">
          <span className="event-toast-kicker">
            <span className="live-dot" aria-hidden="true" />
            Live update
          </span>
          <button
            type="button"
            className="event-toast-close"
            onClick={onDismiss}
            aria-label="Dismiss live update"
          >
            ×
          </button>
        </div>
        <p className="event-toast-title">{copy.label}</p>
        {showDelta ? (
          <p className="event-toast-amount">{formatSignedCents(event.deltaNetCents)}</p>
        ) : null}
        <p className="event-toast-meta">
          {event.merchantId} · {formatIsoDateTime(event.at)}
        </p>
      </div>
    </div>
  );
}
