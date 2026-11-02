// Owner: R5. Persona switcher and onboarding controls (obligations + risk profile).
import type { FormEvent } from "react";
import type { MerchantId, ObligationsSource, RiskProfile } from "@surplus/contracts";
import { PERSONAS, RISK_PROFILES, personaById } from "@/lib/personas";

interface PersonaBarProps {
  merchantId: MerchantId;
  obligationsInput: string;
  obligationsError: string | null;
  obligationsSource: ObligationsSource | null;
  riskProfile: RiskProfile;
  busy: boolean;
  onPersonaChange: (merchantId: MerchantId) => void;
  onObligationsInputChange: (value: string) => void;
  onApplyObligations: () => void;
  onRiskProfileChange: (profile: RiskProfile) => void;
}

export function PersonaBar({
  merchantId,
  obligationsInput,
  obligationsError,
  obligationsSource,
  riskProfile,
  busy,
  onPersonaChange,
  onObligationsInputChange,
  onApplyObligations,
  onRiskProfileChange,
}: PersonaBarProps) {
  const activePersona = personaById(merchantId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApplyObligations();
  }

  return (
    <section className="persona-panel" aria-labelledby="persona-heading">
      <div className="section-head section-head--compact">
        <div>
          <p className="section-kicker">Onboarding</p>
          <h2 className="section-title" id="persona-heading">
            Choose a merchant context
          </h2>
          <p className="section-sub">
            Four deterministic fixture personas plus the live Sandbox merchant. The same
            contract-validated payloads drive every card below.
          </p>
        </div>
        <span className={`source-pill source-pill--${activePersona.dataSource}`}>
          {activePersona.dataSource === "live" ? "Live Sandbox" : "Fixture persona"}
        </span>
      </div>

      <div className="persona-list" role="group" aria-label="Merchant personas">
        {PERSONAS.map((persona) => {
          const selected = persona.id === merchantId;
          return (
            <button
              type="button"
              key={persona.id}
              className="persona-card"
              aria-pressed={selected}
              onClick={() => onPersonaChange(persona.id)}
            >
              <span className="persona-card-top">
                <span className="persona-name">{persona.label}</span>
                <span className={`persona-dot persona-dot--${persona.dataSource}`} />
              </span>
              <span className="persona-short">{persona.shortLabel}</span>
              <span className="persona-description">{persona.description}</span>
            </button>
          );
        })}
      </div>

      <form className="controls-grid" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="monthly-obligations">
            Monthly fixed obligations
          </label>
          <div className={`money-input${obligationsError !== null ? " money-input--error" : ""}`}>
            <span className="money-prefix" aria-hidden="true">
              $
            </span>
            <input
              id="monthly-obligations"
              className="text-input text-input--money"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={obligationsInput}
              onChange={(event) => onObligationsInputChange(event.target.value)}
              aria-invalid={obligationsError !== null}
              aria-describedby="obligations-help"
            />
            <span className="money-suffix">USD / month</span>
          </div>
          <p
            className={`field-hint${obligationsError !== null ? " field-hint--error" : ""}`}
            id="obligations-help"
          >
            {obligationsError ??
              (obligationsSource === "TRAILING_3M_WITHDRAWAL_AVG"
                ? "Using the trailing 3-month withdrawal average until you apply a value."
                : "Integer cents on the wire. The engine owns the buffer math.")}
          </p>
        </div>

        <div className="field">
          <span className="field-label" id="risk-label">
            Risk profile
          </span>
          <div className="segmented" role="group" aria-labelledby="risk-label">
            {RISK_PROFILES.map((option) => (
              <button
                type="button"
                key={option.id}
                className="segment"
                aria-pressed={option.id === riskProfile}
                title={option.description}
                onClick={() => onRiskProfileChange(option.id)}
              >
                <span>{option.label}</span>
                <small>
                  {option.id === "CONSERVATIVE" ? "6" : option.id === "BALANCED" ? "4" : "3"}{" "}
                  tranches
                </small>
              </button>
            ))}
          </div>
          <p className="field-hint">
            Risk profile changes the allocation bands and the number of staged tranches.
          </p>
        </div>

        <div className="field field--action">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Recomputing…" : "Apply & recompute"}
          </button>
          <p className="field-hint field-hint--right">
            POST /api/plan · deterministic engine output only
          </p>
        </div>
      </form>
    </section>
  );
}
