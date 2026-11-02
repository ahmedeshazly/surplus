"use client";

// Owner: R5. Advisor drawer: allocation-band cards, staged allocation table,
// expandable tool trace, cited numbers, and the grounding-validator badge.
// The drawer displays AdvisorResponse + AllocationPlan exactly as returned.
import { useEffect, useState } from "react";
import type {
  AdvisorResponse,
  AllocationPlan,
  AllocationReasonCode,
  MerchantId,
  RiskProfile,
} from "@surplus/contracts";
import { describeApiError, fetchAdvisor } from "@/lib/api";
import {
  formatCents,
  formatIsoDateTime,
  formatToolName,
  formatWholePercent,
  humanizeCode,
} from "@/lib/format";
import { riskProfileLabel } from "@/lib/personas";
import { Markdown } from "./Markdown";
import { EmptyPanel, ErrorPanel, ValidatorBadge } from "./ui";

interface AdvisorDrawerProps {
  open: boolean;
  merchantId: MerchantId;
  obligationsCents: number;
  riskProfile: RiskProfile;
  plan: AllocationPlan | null;
  onClose: () => void;
}

const REASON_LABELS: Record<AllocationReasonCode, string> = {
  BASE_CONSERVATIVE_BAND: "Conservative base band",
  BASE_BALANCED_BAND: "Balanced base band",
  BASE_GROWTH_BAND: "Growth base band",
  HIGH_VOLATILITY_CV_SHIFT: "High-volatility shift",
};

export function AdvisorDrawer({
  open,
  merchantId,
  obligationsCents,
  riskProfile,
  plan,
  onClose,
}: AdvisorDrawerProps) {
  const [advisor, setAdvisor] = useState<AdvisorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAdvisor(merchantId, obligationsCents, riskProfile)
      .then((response) => {
        if (!cancelled) setAdvisor(response);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeApiError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, merchantId, obligationsCents, riskProfile, reloadToken]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const disclaimer = advisor?.disclaimerText ?? plan?.disclaimerText ?? "";

  return (
    <div
      className="drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisor-title"
        aria-describedby="advisor-subtitle"
      >
        <header className="drawer-head">
          <div>
            <p className="section-kicker">Educational advisor</p>
            <h2 className="drawer-title" id="advisor-title">
              Ask AI Advisor
            </h2>
            <p className="drawer-sub" id="advisor-subtitle">
              {riskProfileLabel(riskProfile)} · {formatCents(obligationsCents)} monthly obligations
            </p>
          </div>
          <div className="drawer-head-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setReloadToken((current) => current + 1)}
              disabled={loading}
            >
              {loading ? "Checking…" : "Re-run"}
            </button>
            <button
              type="button"
              className="drawer-close"
              onClick={onClose}
              aria-label="Close advisor"
              autoFocus
            >
              ×
            </button>
          </div>
        </header>

        <div className="drawer-body">
          {loading && advisor === null ? (
            <div className="drawer-loading" aria-busy="true">
              <span className="skeleton skeleton--line" style={{ width: "38%" }} />
              <span className="skeleton skeleton--line" style={{ width: "94%" }} />
              <span className="skeleton skeleton--line" style={{ width: "88%" }} />
              <span className="skeleton skeleton--line" style={{ width: "72%" }} />
            </div>
          ) : error !== null ? (
            <ErrorPanel
              title="The advisor did not respond"
              message={error}
              onRetry={() => setReloadToken((current) => current + 1)}
            />
          ) : advisor !== null ? (
            <>
              <div className="advisor-status-row">
                <ValidatorBadge status={advisor.validatorStatus} />
                <span className="advisor-meta">
                  {advisor.citedNumbers.length} cited metrics · {advisor.toolTrace.length} tool
                  calls · {formatIsoDateTime(advisor.generatedAt)}
                </span>
              </div>

              {advisor.validatorStatus === "FALLBACK_TEMPLATE" ? (
                <div className="inline-alert inline-alert--info" role="note">
                  <div>
                    <strong>Deterministic fallback is active.</strong>
                    <p>
                      The API returned the validated template response. No ungrounded number or
                      security name is shown.
                    </p>
                  </div>
                </div>
              ) : null}

              {advisor.validatorMismatchesCaught.length > 0 ? (
                <details className="mismatch-panel">
                  <summary>
                    Validator caught {advisor.validatorMismatchesCaught.length} mismatch
                    {advisor.validatorMismatchesCaught.length === 1 ? "" : "es"} before output
                  </summary>
                  <ul>
                    {advisor.validatorMismatchesCaught.map((mismatch, index) => (
                      <li key={index}>{mismatch}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <section className="drawer-section" aria-labelledby="advisor-narrative-title">
                <h3 id="advisor-narrative-title">Narrative</h3>
                <div className="narrative-card">
                  <Markdown source={advisor.narrativeMarkdown} />
                </div>
              </section>

              {advisor.citedNumbers.length > 0 ? (
                <section className="drawer-section" aria-labelledby="advisor-cited-title">
                  <h3 id="advisor-cited-title">Grounded numbers</h3>
                  <p className="drawer-section-sub">
                    Each value was checked against tool output before it reached this drawer.
                  </p>
                  <div className="cited-grid">
                    {advisor.citedNumbers.map((metric) => (
                      <span
                        className="cited-chip"
                        key={`${metric.metricCode}-${metric.rawValue}`}
                        title={`${humanizeCode(metric.metricCode)}: ${metric.rawValue}`}
                      >
                        <span>{humanizeCode(metric.metricCode)}</span>
                        <strong>{metric.formattedText}</strong>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="drawer-section" aria-labelledby="advisor-bands-title">
                <h3 id="advisor-bands-title">Allocation bands</h3>
                <p className="drawer-section-sub">
                  Percent-of-surplus bands from the engine. Educational illustration only.
                </p>
                {plan === null ? (
                  <EmptyPanel title="No allocation plan loaded">
                    <p>Recompute the dashboard plan to see the band cards.</p>
                  </EmptyPanel>
                ) : (
                  <>
                    {plan.highVolatilityShiftApplied ? (
                      <div className="inline-alert inline-alert--warn" role="note">
                        <div>
                          <strong>High-volatility shift applied.</strong>
                          <p>
                            The engine moved 10 percentage points from the broad equity index band
                            to cash and money-market instruments.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <div className="band-grid">
                      {plan.bands.map((band) => (
                        <article className="band-card" key={band.assetClass}>
                          <div className="band-head">
                            <span
                              className={`asset-dot asset-dot--${band.assetClass.toLowerCase()}`}
                            />
                            <h4>{band.label}</h4>
                          </div>
                          <p className="band-range">
                            {formatWholePercent(band.minPct)}–{formatWholePercent(band.maxPct)}{" "}
                            range · {formatWholePercent(band.targetMidpointPct)} midpoint
                          </p>
                          <div className="band-bar" aria-hidden="true">
                            <span
                              className={`band-fill band-fill--${band.assetClass.toLowerCase()}`}
                              style={{ width: `${band.targetMidpointPct}%` }}
                            />
                          </div>
                          <div className="band-foot">
                            <span>{formatCents(band.allocatedMidpointCents)}</span>
                            <span>{REASON_LABELS[band.reasonCode]}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="drawer-section" aria-labelledby="advisor-staging-title">
                <h3 id="advisor-staging-title">Staged allocation</h3>
                <p className="drawer-section-sub">
                  Illustrative tranches. Surplus never moves money or executes a trade.
                </p>
                {plan === null ? (
                  <EmptyPanel title="No staging schedule loaded">
                    <p>Recompute the dashboard plan to see the tranche table.</p>
                  </EmptyPanel>
                ) : (
                  <div className="staging-table-wrap">
                    <table className="staging-table">
                      <caption className="sr-only">Staged allocation tranches</caption>
                      <thead>
                        <tr>
                          <th scope="col">Tranche</th>
                          <th scope="col">Execute after</th>
                          <th scope="col" className="numeric">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.stagingSchedule.map((entry) => (
                          <tr key={entry.trancheNumber}>
                            <th scope="row">T{entry.trancheNumber}</th>
                            <td>
                              {entry.executeAfterDays === 0
                                ? "Now"
                                : `${entry.executeAfterDays} days`}
                            </td>
                            <td className="numeric">{formatCents(entry.amountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row" colSpan={2}>
                            Staged total
                          </th>
                          <td className="numeric">{formatCents(plan.safeSurplusCents)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>

              <section className="drawer-section" aria-labelledby="advisor-trace-title">
                <h3 id="advisor-trace-title">Tool trace</h3>
                <p className="drawer-section-sub">
                  Expand a tool call to inspect its sanitized output summary.
                </p>
                {advisor.toolTrace.length === 0 ? (
                  <EmptyPanel title="No tool trace on this response">
                    <p>
                      Fallback responses are built without tool calls; the trace fills in when the
                      grounded agent is available.
                    </p>
                  </EmptyPanel>
                ) : (
                  <div className="trace-list">
                    {advisor.toolTrace.map((entry, index) => (
                      <details className="trace-item" key={`${entry.toolName}-${index}`}>
                        <summary>
                          <span className="trace-name">{formatToolName(entry.toolName)}</span>
                          <span className="trace-duration">{entry.durationMs} ms</span>
                        </summary>
                        <dl className="trace-grid">
                          {Object.entries(entry.sanitizedOutputSummary).map(([key, value]) => (
                            <div key={key}>
                              <dt>{humanizeCode(key)}</dt>
                              <dd>{String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ))}
                  </div>
                )}
              </section>

              {disclaimer.length > 0 ? (
                <footer className="disclaimer">
                  <strong>Educational information only</strong>
                  <p>{disclaimer}</p>
                  <span className="disclaimer-id">{advisor.disclaimerId}</span>
                </footer>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
