"use client";

// Owner: R5. Dashboard shell for tasks F-10, C-8 and H-4.
// It orchestrates contract-validated API calls, the SSE live stream, persona
// controls, the advisor drawer, and the What-If simulator. No money math and no
// scenario math lives in this component.
import { useCallback, useEffect, useState } from "react";
import type { AppEvent, MerchantId, NormalizedTransaction, RiskProfile } from "@surplus/contracts";
import {
  API_BASE_URL,
  describeApiError,
  fetchPlan,
  fetchTransactions,
  subscribeToEvents,
  type EventStreamStatus,
  type PlanBundle,
} from "@/lib/api";
import { centsToDollarInput, parseDollarsToCents } from "@/lib/format";
import { DEFAULT_PERSONA_ID, personaById } from "@/lib/personas";
import { appEventPresentation } from "@/lib/events";
import { AdvisorDrawer } from "./AdvisorDrawer";
import { AuditTable } from "./AuditTable";
import { CashFlowChart } from "./CashFlowChart";
import { LiveEventToast } from "./LiveEventToast";
import { PersonaBar } from "./PersonaBar";
import { ScenarioSimulator } from "./ScenarioSimulator";
import { SummaryCards } from "./SummaryCards";
import { SurplusBreakdown } from "./SurplusBreakdown";
import { DashboardSkeleton, ErrorPanel, InlineError } from "./ui";

const DEFAULT_PERSONA = personaById(DEFAULT_PERSONA_ID);

export function Dashboard() {
  const [merchantId, setMerchantId] = useState<MerchantId>(DEFAULT_PERSONA_ID);
  const [obligationsInput, setObligationsInput] = useState(() =>
    centsToDollarInput(DEFAULT_PERSONA.defaultObligationsCents),
  );
  const [obligationsCents, setObligationsCents] = useState(DEFAULT_PERSONA.defaultObligationsCents);
  const [obligationsError, setObligationsError] = useState<string | null>(null);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("BALANCED");
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [transactions, setTransactions] = useState<NormalizedTransaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [lastEvent, setLastEvent] = useState<AppEvent | null>(null);
  const [lastRibbonEvent, setLastRibbonEvent] = useState<AppEvent | null>(null);
  const [toastEvent, setToastEvent] = useState<AppEvent | null>(null);
  const [highlight, setHighlight] = useState(false);
  const [sseStatus, setSseStatus] = useState<EventStreamStatus>("connecting");

  const activePersona = personaById(merchantId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchPlan(merchantId, obligationsCents, riskProfile),
      fetchTransactions(merchantId),
    ])
      .then(([nextBundle, nextTransactions]) => {
        if (cancelled) return;
        setBundle(nextBundle);
        setTransactions(nextTransactions);
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
  }, [merchantId, obligationsCents, riskProfile, reloadToken]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(merchantId, {
      onStatus: (status) => setSseStatus(status),
      onEvent: (event) => {
        setBundle({
          summary: event.updatedSummary,
          surplus: event.updatedSurplus,
          plan: event.updatedPlan,
        });
        setError(null);
        setLoading(false);
        setLastEvent(event);
        // `plan.updated` is a recompute follow-up, not a cash event. Keep the
        // last payment/refund/dispute event so the summary ribbon and its amount
        // stay visible instead of being replaced by a neutral plan update.
        if (event.type !== "plan.updated") setLastRibbonEvent(event);
        setHighlight(true);
        setToastEvent((current) =>
          event.type === "plan.updated" && current !== null ? current : event,
        );

        // Reconcile the event payload with the currently selected obligations
        // and risk profile, and pull in the new normalized transaction row.
        void Promise.all([
          fetchPlan(merchantId, obligationsCents, riskProfile),
          fetchTransactions(merchantId),
        ])
          .then(([nextBundle, nextTransactions]) => {
            setBundle(nextBundle);
            setTransactions(nextTransactions);
          })
          .catch(() => {
            // Keep the validated event payload already on screen.
          });
      },
    });

    return unsubscribe;
  }, [merchantId, obligationsCents, riskProfile]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (toastEvent === null) return;
    const timer = window.setTimeout(() => setToastEvent(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [toastEvent]);

  const closeAdvisor = useCallback(() => setAdvisorOpen(false), []);

  function handlePersonaChange(nextMerchantId: MerchantId) {
    const nextPersona = personaById(nextMerchantId);
    setMerchantId(nextMerchantId);
    setObligationsCents(nextPersona.defaultObligationsCents);
    setObligationsInput(centsToDollarInput(nextPersona.defaultObligationsCents));
    setObligationsError(null);
    setBundle(null);
    setTransactions(null);
    setError(null);
    setLastEvent(null);
    setLastRibbonEvent(null);
    setToastEvent(null);
    setAdvisorOpen(false);
  }

  function handleApplyObligations() {
    const parsed = parseDollarsToCents(obligationsInput);
    if (parsed === null) {
      setObligationsError("Enter a non-negative dollar amount, for example 3000.00.");
      return;
    }
    setObligationsError(null);
    if (parsed === obligationsCents) {
      setReloadToken((current) => current + 1);
    } else {
      setObligationsCents(parsed);
    }
  }

  const sseLabel =
    sseStatus === "open"
      ? "Live SSE connected"
      : sseStatus === "error"
        ? "SSE reconnecting…"
        : "Connecting SSE…";
  const eventCopy = lastEvent === null ? null : appEventPresentation(lastEvent.type);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <div>
              <span className="brand-name">Surplus</span>
              <span className="brand-tag">Treasury runway, explained</span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`status-chip status-chip--${sseStatus}`} title={API_BASE_URL}>
              <span className="sse-dot" aria-hidden="true" />
              {sseLabel}
            </span>
            <span className={`source-pill source-pill--${activePersona.dataSource}`}>
              {activePersona.dataSource === "live" ? "Live Sandbox" : "Fixture"}
            </span>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => setAdvisorOpen(true)}
              disabled={bundle === null}
            >
              Ask AI Advisor
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <p className="section-kicker">Explainable idle-cash planning</p>
            <h1 className="hero-title">
              Know your safe-to-invest surplus — and see every formula behind it.
            </h1>
            <p className="hero-sub">
              Surplus reads normalized PayPal cash flow, reserves for volatility, refunds and open
              disputes, then shows a deterministic runway and a staged educational allocation. The
              LLM narrates; it never does the math.
            </p>
          </div>
          <div className="hero-side">
            <div className="hero-stat">
              <span className="hero-stat-label">Active merchant</span>
              <strong>{activePersona.label}</strong>
              <span className="hero-stat-note">{activePersona.description}</span>
            </div>
            <div className="hero-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => setAdvisorOpen(true)}
                disabled={bundle === null}
              >
                Open advisor drawer
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setReloadToken((current) => current + 1)}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "Refresh data"}
              </button>
            </div>
            {lastEvent !== null && eventCopy !== null ? (
              <p className="hero-last-event">
                Last live event: <strong>{eventCopy.label}</strong> ·{" "}
                {appEventPresentation(lastEvent.type).shortLabel}
              </p>
            ) : (
              <p className="hero-last-event">
                SSE is connected to <code>/api/events</code>; a validated webhook will toast here.
              </p>
            )}
          </div>
        </section>

        <PersonaBar
          merchantId={merchantId}
          obligationsInput={obligationsInput}
          obligationsError={obligationsError}
          obligationsSource={bundle?.surplus.obligationsSource ?? null}
          riskProfile={riskProfile}
          busy={loading}
          onPersonaChange={handlePersonaChange}
          onObligationsInputChange={(value) => {
            setObligationsInput(value);
            setObligationsError(null);
          }}
          onApplyObligations={handleApplyObligations}
          onRiskProfileChange={setRiskProfile}
        />

        {loading && bundle !== null ? (
          <div className="refresh-strip" role="status">
            <span className="refresh-spinner" aria-hidden="true" />
            Recomputed from the engine…
          </div>
        ) : null}

        {error !== null && bundle !== null ? (
          <InlineError message={error} onRetry={() => setReloadToken((current) => current + 1)} />
        ) : null}

        {bundle === null && loading ? <DashboardSkeleton /> : null}

        {bundle === null && !loading && error !== null ? (
          <ErrorPanel message={error} onRetry={() => setReloadToken((current) => current + 1)} />
        ) : null}

        {bundle !== null ? (
          <div className="dashboard-content">
            <SummaryCards
              summary={bundle.summary}
              surplus={bundle.surplus}
              liveEvent={lastRibbonEvent}
              highlight={highlight}
            />

            <div className="content-grid">
              <CashFlowChart summary={bundle.summary} />
              <SurplusBreakdown surplus={bundle.surplus} />
            </div>

            <AuditTable transactions={transactions} />

            <ScenarioSimulator
              key={`${merchantId}-${obligationsCents}-${riskProfile}`}
              merchantId={merchantId}
              monthlyObligationsCents={obligationsCents}
              riskProfile={riskProfile}
            />
          </div>
        ) : null}

        <footer className="page-footer">
          <p>
            Data honesty: fixture personas use deterministic 12-month datasets. The live Sandbox
            merchant starts empty and changes only through verified PayPal webhooks.
          </p>
          <p>Educational information only — Surplus never moves money or recommends a security.</p>
        </footer>
      </main>

      <AdvisorDrawer
        open={advisorOpen}
        merchantId={merchantId}
        obligationsCents={obligationsCents}
        riskProfile={riskProfile}
        plan={bundle?.plan ?? null}
        onClose={closeAdvisor}
      />

      {toastEvent !== null ? (
        <LiveEventToast
          key={toastEvent.eventId}
          event={toastEvent}
          onDismiss={() => setToastEvent(null)}
        />
      ) : null}
    </div>
  );
}
