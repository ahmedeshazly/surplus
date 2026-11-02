// Owner: R5. Monthly net cash-flow chart drawn with inline SVG so the dashboard
// ships with the dependencies already present in apps/web. Geometry is display
// only; every value is read from CashFlowSummary.monthlySeries.
import type { CashFlowSummary } from "@surplus/contracts";
import {
  formatCents,
  formatCompactCents,
  formatMonthBucket,
  formatMonthBucketShort,
  formatSignedCents,
} from "@/lib/format";
import { EmptyPanel } from "./ui";

const WIDTH = 760;
const HEIGHT = 300;
const PADDING = { top: 24, right: 18, bottom: 52, left: 64 };

interface CashFlowChartProps {
  summary: CashFlowSummary;
}

export function CashFlowChart({ summary }: CashFlowChartProps) {
  const series = summary.monthlySeries;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const count = series.length;

  if (count === 0) {
    return (
      <article className="card chart-card" aria-labelledby="cashflow-chart-title">
        <div className="card-head">
          <div>
            <p className="card-kicker">Trend</p>
            <h3 className="card-title" id="cashflow-chart-title">
              Monthly net cash flow
            </h3>
          </div>
        </div>
        <EmptyPanel title="No completed months yet">
          <p>
            The engine needs completed calendar months before it can draw a trend. Live Sandbox
            merchants start empty and fill in as verified webhooks arrive.
          </p>
        </EmptyPanel>
      </article>
    );
  }

  const maxAbsolute = Math.max(...series.map((point) => Math.abs(point.netCents)), 1);
  const zeroY = PADDING.top + plotHeight / 2;
  const yFor = (value: number) => zeroY - (value / maxAbsolute) * (plotHeight / 2);
  const slotWidth = plotWidth / count;
  const barWidth = Math.max(8, Math.min(38, slotWidth * 0.56));
  const labelEvery = Math.max(1, Math.ceil(count / 8));
  const ticks = [maxAbsolute, maxAbsolute / 2, 0, -maxAbsolute / 2, -maxAbsolute];

  return (
    <article className="card chart-card" aria-labelledby="cashflow-chart-title">
      <div className="card-head">
        <div>
          <p className="card-kicker">Trend</p>
          <h3 className="card-title" id="cashflow-chart-title">
            Monthly net cash flow
          </h3>
          <p className="card-sub">
            Completed calendar months only · in-progress month excluded ·{" "}
            {summary.completedMonthsCount} months
          </p>
        </div>
        <div className="chart-legend" aria-hidden="true">
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--positive" /> Positive
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--negative" /> Negative
          </span>
        </div>
      </div>

      <div className="chart-wrap">
        <svg
          className="chart-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Monthly net cash flow for ${count} completed months. Baseline monthly net is ${formatCents(summary.baselineMonthlyNetCents)}. Trend is ${formatSignedCents(summary.trendSlopeCentsPerMonth)} per month.`}
        >
          {ticks.map((tick) => {
            const y = yFor(tick);
            const isZero = tick === 0;
            return (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  className={isZero ? "chart-axis chart-axis--zero" : "chart-axis"}
                />
                <text x={PADDING.left - 10} y={y + 4} textAnchor="end" className="chart-tick">
                  {formatCompactCents(tick)}
                </text>
              </g>
            );
          })}

          {series.map((point, index) => {
            const x = PADDING.left + slotWidth * index + (slotWidth - barWidth) / 2;
            const valueY = yFor(point.netCents);
            const top = point.netCents >= 0 ? valueY : zeroY;
            const height = Math.max(1, Math.abs(valueY - zeroY));
            const showLabel = index % labelEvery === 0 || index === count - 1;
            return (
              <g key={point.monthBucket}>
                <rect
                  x={x}
                  y={top}
                  width={barWidth}
                  height={height}
                  rx={Math.min(5, barWidth / 3)}
                  className={
                    point.netCents >= 0
                      ? "chart-bar chart-bar--positive"
                      : "chart-bar chart-bar--negative"
                  }
                >
                  <title>
                    {formatMonthBucket(point.monthBucket)}: {formatSignedCents(point.netCents)} net
                  </title>
                </rect>
                {showLabel ? (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 24}
                    textAnchor="middle"
                    className="chart-tick chart-tick--x"
                  >
                    {formatMonthBucketShort(point.monthBucket)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="chart-foot">
        <p>
          Median completed-month net:{" "}
          <strong>{formatCents(summary.baselineMonthlyNetCents)}</strong>
        </p>
        <p>
          Trend slope: <strong>{formatSignedCents(summary.trendSlopeCentsPerMonth)} / month</strong>
        </p>
      </div>

      <details className="chart-data">
        <summary>View monthly data table</summary>
        <div className="chart-data-scroll">
          <table>
            <caption className="sr-only">Monthly net cash flow by completed month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="numeric">
                  Gross income
                </th>
                <th scope="col" className="numeric">
                  Fees
                </th>
                <th scope="col" className="numeric">
                  Refunds
                </th>
                <th scope="col" className="numeric">
                  Chargebacks
                </th>
                <th scope="col" className="numeric">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.monthBucket}>
                  <th scope="row">{formatMonthBucket(point.monthBucket)}</th>
                  <td className="numeric">{formatCents(point.grossIncomeCents)}</td>
                  <td className="numeric">{formatCents(point.feesCents)}</td>
                  <td className="numeric">{formatCents(point.refundsCents)}</td>
                  <td className="numeric">{formatCents(point.chargebacksCents)}</td>
                  <td className={point.netCents >= 0 ? "numeric positive" : "numeric negative"}>
                    {formatSignedCents(point.netCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
