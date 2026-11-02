"use client";

// Owner: R5. What-If scenario controls. The browser sends ScenarioInput to the
// existing POST /api/scenario route and renders ScenarioComparisonResult; it
// never calculates a stressed surplus, delta, or band locally.
import { useState, type FormEvent } from "react";
import type {
  MerchantId,
  RiskProfile,
  ScenarioComparisonResult,
  ScenarioInput,
} from "@surplus/contracts";
import { describeApiError, runScenario } from "@/lib/api";
import {
  formatCents,
  formatMonths,
  formatSignedCents,
  formatWholePercent,
  parseDollarsToCents,
} from "@/lib/format";
import { EmptyPanel, InlineError } from "./ui";

interface ScenarioSimulatorProps {
  merchantId: MerchantId;
  monthlyObligationsCents: number;
  riskProfile: RiskProfile;
}

const SHOCK_MIN = -80;
const SHOCK_MAX = 50;

export function ScenarioSimulator({
  merchantId,
  monthlyObligationsCents,
  riskProfile,
}: ScenarioSimulatorProps) {
  const [incomeShockPct, setIncomeShockPct] = useState(-30);
  const [delayedInput, setDelayedInput] = useState("0.00");
  const [expenseInput, setExpenseInput] = useState("0.00");
  const [result, setResult] = useState<ScenarioComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetResult() {
    setResult(null);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const delayedPaymentCents = parseDollarsToCents(delayedInput);
    const oneOffExpenseCents = parseDollarsToCents(expenseInput);
    if (delayedPaymentCents === null || oneOffExpenseCents === null) {
      setError("Enter delayed payments and one-off expenses as non-negative dollar amounts.");
      return;
    }

    const input: ScenarioInput = {
      merchantId,
      monthlyObligationsCents,
      riskProfile,
      incomeShockPct,
      delayedPaymentCents,
      oneOffExpenseCents,
    };

    setLoading(true);
    setError(null);
    runScenario(input)
      .then((nextResult) => {
        setResult(nextResult);
      })
      .catch((cause: unknown) => {
        setError(describeApiError(cause));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  const deltaMonths = result === null ? 0 : result.deltaBufferMonths;
  const deltaMonthsLabel = `${deltaMonths >= 0 ? "+" : ""}${deltaMonths.toFixed(2)} months`;

  return (
    <section className="card scenario-card" aria-labelledby="scenario-title">
      <div className="card-head card-head--wrap">
        <div>
          <p className="card-kicker">What-If simulator</p>
          <h2 className="card-title" id="scenario-title">
            Stress the surplus
          </h2>
          <p className="card-sub">
            POST /api/scenario · computed by <code>@surplus/engine</code>, never in the browser
          </p>
        </div>
        <span className="data-note">Server-computed deltas</span>
      </div>

      <div className="scenario-layout">
        <form className="scenario-form" onSubmit={handleSubmit}>
          <div className="slider-block">
            <div className="slider-head">
              <label htmlFor="income-shock">Income shock</label>
              <output htmlFor="income-shock" className="slider-value">
                {incomeShockPct > 0 ? "+" : ""}
                {incomeShockPct}%
              </output>
            </div>
            <input
              id="income-shock"
              className="range"
              type="range"
              min={SHOCK_MIN}
              max={SHOCK_MAX}
              step={5}
              value={incomeShockPct}
              onChange={(event) => {
                setIncomeShockPct(Number(event.target.value));
                resetResult();
              }}
              aria-valuetext={`${incomeShockPct} percent income shock`}
            />
            <div className="range-scale" aria-hidden="true">
              <span>{SHOCK_MIN}%</span>
              <span>0%</span>
              <span>+{SHOCK_MAX}%</span>
            </div>
          </div>

          <div className="scenario-fields">
            <div className="field">
              <label className="field-label" htmlFor="delayed-payment">
                Delayed payment
              </label>
              <div className="money-input">
                <span className="money-prefix" aria-hidden="true">
                  $
                </span>
                <input
                  id="delayed-payment"
                  className="text-input text-input--money"
                  type="text"
                  inputMode="decimal"
                  value={delayedInput}
                  onChange={(event) => {
                    setDelayedInput(event.target.value);
                    resetResult();
                  }}
                />
                <span className="money-suffix">USD</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="one-off-expense">
                One-off expense
              </label>
              <div className="money-input">
                <span className="money-prefix" aria-hidden="true">
                  $
                </span>
                <input
                  id="one-off-expense"
                  className="text-input text-input--money"
                  type="text"
                  inputMode="decimal"
                  value={expenseInput}
                  onChange={(event) => {
                    setExpenseInput(event.target.value);
                    resetResult();
                  }}
                />
                <span className="money-suffix">USD</span>
              </div>
            </div>
          </div>

          {error !== null ? <InlineError message={error} /> : null}

          <div className="scenario-actions">
            <button type="submit" className="button button--primary" disabled={loading}>
              {loading ? "Running stress test…" : "Run stress test"}
            </button>
            <p className="field-hint">
              Shock range {SHOCK_MIN}% to +{SHOCK_MAX}%. Results replace nothing on the dashboard.
            </p>
          </div>
        </form>

        <div className="scenario-output" aria-live="polite">
          {loading ? (
            <div className="scenario-loading" aria-busy="true">
              <span className="skeleton skeleton--line" style={{ width: "42%" }} />
              <span className="skeleton skeleton--value" />
              <span className="skeleton skeleton--line" style={{ width: "78%" }} />
            </div>
          ) : result === null ? (
            <EmptyPanel title="No stress test yet">
              <p>
                Move the income-shock slider, optionally add a delayed payment or one-off expense,
                then run the server-side comparison.
              </p>
            </EmptyPanel>
          ) : (
            <div className="scenario-result">
              <div className="scenario-result-head">
                <div>
                  <p className="card-kicker">Stress result</p>
                  <h3>Safe surplus under stress</h3>
                </div>
                <span
                  className={`model-badge model-badge--${
                    result.stressedSurplus.modelStatus === "OK" ? "ok" : "warn"
                  }`}
                >
                  {result.stressedSurplus.modelStatus.replaceAll("_", " ")}
                </span>
              </div>

              <div className="result-compare">
                <div>
                  <span className="compare-label">Baseline</span>
                  <strong>{formatCents(result.baselineSurplus.safeSurplusCents)}</strong>
                </div>
                <span className="compare-arrow" aria-hidden="true">
                  →
                </span>
                <div>
                  <span className="compare-label">Stressed</span>
                  <strong>{formatCents(result.stressedSurplus.safeSurplusCents)}</strong>
                </div>
              </div>

              <div className="delta-row">
                <div
                  className={`delta-card ${
                    result.deltaSafeSurplusCents < 0
                      ? "delta-card--negative"
                      : "delta-card--positive"
                  }`}
                >
                  <span>Δ Safe surplus</span>
                  <strong>{formatSignedCents(result.deltaSafeSurplusCents)}</strong>
                </div>
                <div className="delta-card">
                  <span>Δ Buffer runway</span>
                  <strong>{deltaMonthsLabel}</strong>
                </div>
              </div>

              <dl className="result-facts">
                <div>
                  <dt>Stressed buffer</dt>
                  <dd>{formatMonths(result.stressedSurplus.bufferMonths)}</dd>
                </div>
                <div>
                  <dt>Buffer target</dt>
                  <dd>{formatCents(result.stressedSurplus.bufferTargetCents)}</dd>
                </div>
                <div>
                  <dt>Risk reserve</dt>
                  <dd>{formatCents(result.stressedSurplus.riskReserveCents)}</dd>
                </div>
                <div>
                  <dt>Tranches</dt>
                  <dd>{result.stressedSurplus.stagingTrancheCount}</dd>
                </div>
              </dl>

              <div className="scenario-bands">
                <h4>Stressed allocation</h4>
                <div className="mini-band-list">
                  {result.stressedPlan.bands.map((band) => (
                    <div className="mini-band" key={band.assetClass}>
                      <span>
                        {band.label}
                        <small>{formatWholePercent(band.targetMidpointPct)} midpoint</small>
                      </span>
                      <strong>{formatCents(band.allocatedMidpointCents)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <p className="scenario-note">
                Inputs: {result.scenarioInput.incomeShockPct > 0 ? "+" : ""}
                {result.scenarioInput.incomeShockPct}% income shock ·{" "}
                {formatCents(result.scenarioInput.delayedPaymentCents)} delayed ·{" "}
                {formatCents(result.scenarioInput.oneOffExpenseCents)} one-off expense.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
