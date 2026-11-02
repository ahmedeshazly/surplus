// Owner: R5. Week / month / year summary cards and risk-signal strip.
import type {
  AppEvent,
  CashFlowSummary,
  SurplusResult,
  WindowLabel,
  WindowTotals,
} from "@surplus/contracts";
import {
  formatCents,
  formatIsoDateTime,
  formatMonths,
  formatRatioPercent,
  formatSignedCents,
  formatWindowRange,
} from "@/lib/format";
import { appEventPresentation } from "@/lib/events";

interface SummaryCardsProps {
  summary: CashFlowSummary;
  surplus: SurplusResult;
  liveEvent: AppEvent | null;
  highlight: boolean;
}

const WINDOWS: { key: WindowLabel; label: string; trailing: string }[] = [
  { key: "week", label: "This week", trailing: "Trailing 7 days" },
  { key: "month", label: "This month", trailing: "Trailing 30 days" },
  { key: "year", label: "This year", trailing: "Trailing 365 days" },
];

function WindowCard({
  totals,
  label,
  trailing,
  highlight,
}: {
  totals: WindowTotals;
  label: string;
  trailing: string;
  highlight: boolean;
}) {
  return (
    <article className={`card summary-card${highlight ? " summary-card--live" : ""}`}>
      <div className="summary-card-head">
        <div>
          <p className="card-kicker">{trailing}</p>
          <h3 className="card-title">{label}</h3>
        </div>
        <span className="window-label">{totals.windowLabel}</span>
      </div>
      <p className="summary-value">{formatCents(totals.netCashFlowCents)}</p>
      <p className="summary-caption">Net cash flow</p>
      <p className="summary-range">{formatWindowRange(totals.startDate, totals.endDate)}</p>
      <dl className="summary-breakdown">
        <div>
          <dt>Gross income</dt>
          <dd>{formatCents(totals.grossIncomeCents)}</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>{formatCents(totals.feesCents)}</dd>
        </div>
        <div>
          <dt>Refunds</dt>
          <dd>{formatCents(totals.refundsCents)}</dd>
        </div>
        <div>
          <dt>Chargebacks</dt>
          <dd>{formatCents(totals.chargebacksCents)}</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>{totals.transactionCount}</dd>
        </div>
      </dl>
    </article>
  );
}

export function SummaryCards({ summary, surplus, liveEvent, highlight }: SummaryCardsProps) {
  const eventCopy = liveEvent === null ? null : appEventPresentation(liveEvent.type);
  const showLiveRibbon = liveEvent !== null && liveEvent.type !== "plan.updated";

  return (
    <section className="summary-section" aria-labelledby="summary-heading">
      <div className="section-head section-head--compact">
        <div>
          <p className="section-kicker">Cash flow</p>
          <h2 className="section-title" id="summary-heading">
            Trailing windows
          </h2>
          <p className="section-sub">
            Anchored at {formatIsoDateTime(summary.asOf)} · {summary.completedMonthsCount} completed
            months in the model
          </p>
        </div>
        <span className="data-note">Integer cents from the API</span>
      </div>

      {showLiveRibbon && liveEvent !== null && eventCopy !== null ? (
        <div
          className={`live-ribbon live-ribbon--${eventCopy.tone}`}
          role="status"
          aria-live="polite"
        >
          <span className="live-ribbon-dot" aria-hidden="true" />
          <div>
            <strong>{eventCopy.label}</strong>
            <span className="live-ribbon-amount">{formatSignedCents(liveEvent.deltaNetCents)}</span>
            <span className="live-ribbon-time">at {formatIsoDateTime(liveEvent.at)}</span>
          </div>
        </div>
      ) : null}

      <div className="summary-grid">
        {WINDOWS.map((window) => (
          <WindowCard
            key={window.key}
            totals={summary.windows[window.key]}
            label={window.label}
            trailing={window.trailing}
            highlight={highlight}
          />
        ))}

        <article className="card summary-card summary-card--signals">
          <div className="summary-card-head">
            <div>
              <p className="card-kicker">Model inputs</p>
              <h3 className="card-title">Risk signals</h3>
            </div>
            <span className="window-label">Engine</span>
          </div>
          <dl className="signal-list">
            <div>
              <dt>Income volatility (CV)</dt>
              <dd>{summary.cv.toFixed(4)}</dd>
            </div>
            <div>
              <dt>90-day refund rate</dt>
              <dd>{formatRatioPercent(summary.refundRate90d)}</dd>
            </div>
            <div>
              <dt>Open disputes</dt>
              <dd>
                {summary.openDisputes.count} · {formatCents(summary.openDisputes.totalAmountCents)}
              </dd>
            </div>
            <div>
              <dt>Baseline monthly net</dt>
              <dd>{formatCents(summary.baselineMonthlyNetCents)}</dd>
            </div>
            <div>
              <dt>Buffer runway</dt>
              <dd>{formatMonths(surplus.bufferMonths)}</dd>
            </div>
          </dl>
          <p className="summary-footnote">
            CV and refund rate are computed by the engine; the UI only formats them.
          </p>
        </article>
      </div>
    </section>
  );
}
