// Owner: R5. Shared loading, empty, and error states for the dashboard.
import type { ReactNode } from "react";

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-alert inline-alert--error" role="alert">
      <div>
        <strong>Could not refresh the dashboard.</strong>
        <p>{message}</p>
      </div>
      {onRetry !== undefined ? (
        <button type="button" className="button button--small" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function ErrorPanel({
  title = "The dashboard could not load",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <span className="state-icon" aria-hidden="true">
        !
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      <p className="state-hint">
        The browser only displays contract-validated API responses. Nothing is estimated locally.
      </p>
      {onRetry !== undefined ? (
        <button type="button" className="button button--primary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function EmptyPanel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <span className="empty-icon" aria-hidden="true">
        ∅
      </span>
      <h3>{title}</h3>
      <div className="empty-copy">{children}</div>
      {action}
    </div>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return <span className="skeleton skeleton--line" style={{ width }} />;
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton-panel">
        <SkeletonLine width="34%" />
        <SkeletonLine width="68%" />
        <div className="skeleton-row">
          <SkeletonLine width="20%" />
          <SkeletonLine width="20%" />
          <SkeletonLine width="20%" />
        </div>
      </div>
      <div className="summary-grid">
        {[0, 1, 2, 3].map((index) => (
          <div className="card skeleton-card" key={index}>
            <SkeletonLine width="40%" />
            <span className="skeleton skeleton--value" />
            <SkeletonLine width="72%" />
            <SkeletonLine width="55%" />
          </div>
        ))}
      </div>
      <div className="content-grid">
        <div className="card skeleton-card skeleton-card--tall">
          <SkeletonLine width="32%" />
          <span className="skeleton skeleton--chart" />
        </div>
        <div className="card skeleton-card skeleton-card--tall">
          <SkeletonLine width="45%" />
          <SkeletonLine width="90%" />
          <SkeletonLine width="82%" />
          <SkeletonLine width="86%" />
          <SkeletonLine width="70%" />
        </div>
      </div>
      <div className="card skeleton-card skeleton-card--tall">
        <SkeletonLine width="28%" />
        <SkeletonLine width="96%" />
        <SkeletonLine width="92%" />
        <SkeletonLine width="94%" />
      </div>
    </div>
  );
}

export function ValidatorBadge({
  status,
}: {
  status: "PASSED" | "REGENERATED_PASSED" | "FALLBACK_TEMPLATE";
}) {
  const config = {
    PASSED: {
      label: "Validator: PASSED",
      tone: "pass",
      detail: "Every number matched tool output.",
    },
    REGENERATED_PASSED: {
      label: "Validator: REGENERATED",
      tone: "warn",
      detail: "A first draft was rejected, then regenerated cleanly.",
    },
    FALLBACK_TEMPLATE: {
      label: "Validator: FALLBACK TEMPLATE",
      tone: "fallback",
      detail: "The model output was unavailable or failed checks; deterministic copy is shown.",
    },
  }[status];

  return (
    <span className={`validator-badge validator-badge--${config.tone}`} title={config.detail}>
      <span className="validator-dot" aria-hidden="true" />
      {config.label}
    </span>
  );
}
