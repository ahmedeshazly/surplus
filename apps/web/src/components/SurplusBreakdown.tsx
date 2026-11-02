// Owner: R5. Formula-by-formula surplus breakdown. Values and formula text are
// rendered exactly as the engine returns them; no result is recalculated here.
import type { BreakdownLine, SurplusModelStatus, SurplusResult } from "@surplus/contracts";
import { formatCents, formatDecimal, formatMonths } from "@/lib/format";

interface SurplusBreakdownProps {
  surplus: SurplusResult;
}

const STATUS_COPY: Record<
  SurplusModelStatus,
  { label: string; tone: string; title: string; body: string }
> = {
  OK: {
    label: "Model OK",
    tone: "ok",
    title: "The engine has enough history",
    body: "The buffer and risk reserve are fully funded before any surplus is staged.",
  },
  INSUFFICIENT_DATA: {
    label: "Insufficient data",
    tone: "warn",
    title: "At least 3 completed months are required",
    body: "The safe surplus stays at $0.00 until the account has enough completed calendar months.",
  },
  OBLIGATIONS_REQUIRED: {
    label: "Obligations required",
    tone: "warn",
    title: "Add monthly fixed obligations",
    body: "The engine needs a positive monthly obligations value before it can size a cash buffer.",
  },
  NEGATIVE_CASH_FLOW: {
    label: "Negative cash flow",
    tone: "danger",
    title: "The model is holding the surplus at $0.00",
    body: "Median or mean monthly net is not positive, so the full cash buffer is treated as needed runway.",
  },
};

function lineValue(line: BreakdownLine): string {
  if (line.unit === "USD_CENTS" && line.valueCents !== undefined) {
    return formatCents(line.valueCents);
  }
  if (line.unit === "MONTHS" && line.valueScalar !== undefined) {
    return formatMonths(line.valueScalar);
  }
  if (line.unit === "RATIO" && line.valueScalar !== undefined) {
    return formatDecimal(line.valueScalar, 4);
  }
  return "—";
}

export function SurplusBreakdown({ surplus }: SurplusBreakdownProps) {
  const status = STATUS_COPY[surplus.modelStatus];
  const emphasisCodes = new Set(["BUFFER_TARGET", "TOTAL_RISK_RESERVE", "SAFE_SURPLUS"]);

  return (
    <article className="card breakdown-card" aria-labelledby="breakdown-title">
      <div className="card-head">
        <div>
          <p className="card-kicker">Surplus breakdown</p>
          <h3 className="card-title" id="breakdown-title">
            Every formula, in order
          </h3>
          <p className="card-sub">
            Deterministic output from <code>@surplus/engine</code> · integer cents
          </p>
        </div>
        <span className={`model-badge model-badge--${status.tone}`}>{status.label}</span>
      </div>

      <div className={`breakdown-hero breakdown-hero--${status.tone}`}>
        <p className="breakdown-hero-label">Safe-to-invest surplus</p>
        <p className="breakdown-hero-value">{formatCents(surplus.safeSurplusCents)}</p>
        <p className="breakdown-hero-formula">
          {formatCents(surplus.availableBalanceCents)} available −{" "}
          {formatCents(surplus.bufferTargetCents)} buffer − {formatCents(surplus.riskReserveCents)}{" "}
          risk reserve
        </p>
        <div className="breakdown-pills">
          <span>{formatMonths(surplus.bufferMonths)} runway</span>
          <span>{surplus.stagingTrancheCount} tranches</span>
          <span>CV {formatDecimal(surplus.cv, 4)}</span>
          <span>
            {surplus.obligationsSource === "USER_INPUT" ? "User obligations" : "Trailing average"}
          </span>
        </div>
      </div>

      <div className={`status-panel status-panel--${status.tone}`} role="note">
        <strong>{status.title}.</strong> {status.body}
      </div>

      <ol className="formula-list">
        {surplus.breakdownLines.map((line, index) => (
          <li
            key={line.code}
            className={`formula-item${emphasisCodes.has(line.code) ? " formula-item--emphasis" : ""}`}
          >
            <span className="formula-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="formula-body">
              <div className="formula-heading">
                <span className="formula-label">{line.label}</span>
                <span className="formula-value">{lineValue(line)}</span>
              </div>
              <code className="formula-text">{line.formulaText}</code>
            </div>
          </li>
        ))}
      </ol>

      <div className="staging-chips">
        <span className="staging-chips-label">Staging schedule</span>
        <div className="staging-chip-row">
          {surplus.stagingScheduleCents.map((amountCents, index) => (
            <span className="staging-chip" key={`${surplus.merchantId}-tranche-${index + 1}`}>
              <small>T{index + 1}</small>
              {formatCents(amountCents)}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
