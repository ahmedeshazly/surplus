# Surplus dashboard wireframes (K-6)

Owner: R5. Status: implementation-ready, **pending R6 approval**.
Scope: Dashboard, Surplus Breakdown, transaction audit grid, Advisor drawer, What-If simulator.
Related tasks: K-6 (wireframes), F-10 (dashboard/Recharts/audit grid), C-8 (advisor/scenario/SSE), H-4 (states and polish).

All values shown in these screens come from `@surplus/contracts` payloads produced by
`apps/api` and `@surplus/engine`. The browser formats money for display only. It never calculates
a surplus, buffer, allocation, delta, or staged amount.

---

## 1. Product frame

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Top bar: Surplus mark · "Treasury runway, explained"                        │
│          SSE status chip · Live/Fixture badge · Ask AI Advisor              │
├─────────────────────────────────────────────────────────────────────────────┤
│ Hero: headline · data-honesty sentence · active merchant · actions         │
├─────────────────────────────────────────────────────────────────────────────┤
│ Onboarding: five persona cards · monthly obligations · risk profile        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Week / month / year cards · risk signals card                              │
├──────────────────────────────────┬──────────────────────────────────────────┤
│ Monthly net cash-flow chart      │ Surplus breakdown (10 formula lines)     │
├──────────────────────────────────┴──────────────────────────────────────────┤
│ Normalized transaction audit grid                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ What-If scenario simulator                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Data-honesty + educational-only footer                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                                              ┌────────────────┐
                                                              │ Advisor drawer │
                                                              │ (right overlay)│
                                                              └────────────────┘
                                                              ┌────────────────┐
                                                              │ Live toast     │
                                                              │ (bottom-right) │
                                                              └────────────────┘
```

### Component hierarchy

```
apps/web/src/app/page.tsx
└── Dashboard (client shell)
    ├── TopBar + Hero actions
    ├── PersonaBar
    │   ├── Persona cards (5 MerchantId values)
    │   ├── Monthly obligations input (display dollars -> integer cents)
    │   └── Risk profile segmented control (CONSERVATIVE / BALANCED / GROWTH)
    ├── SummaryCards
    │   ├── WindowTotals cards: week, month, year
    │   └── Risk signals: CV, 90-day refund rate, disputes, baseline, buffer
    ├── CashFlowChart
    │   ├── SVG bars over MonthlyNetPoint[]
    │   └── Expandable monthly data table
    ├── SurplusBreakdown
    │   ├── Safe-surplus hero
    │   ├── 10 BreakdownLine rows in canonical order
    │   └── Staging tranche chips
    ├── AuditTable
    │   ├── Kind filter + quick filter
    │   ├── Sortable columns
    │   └── Pager
    ├── ScenarioSimulator
    │   ├── Income-shock slider (-80% to +50%)
    │   ├── Delayed payment + one-off expense inputs
    │   └── Server-returned ScenarioComparisonResult
    ├── LiveEventToast
    └── AdvisorDrawer
        ├── Validator badge + metrics
        ├── Narrative
        ├── Grounded-number chips
        ├── Allocation band cards
        ├── Staged allocation table
        ├── Expandable tool trace
        └── Mandatory disclaimer
```

---

## 2. Data sources and contract mapping

| UI surface                | API                                 | Contract                                               |
| ------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Dashboard / summary cards | `POST /api/plan` (bundle)           | `CashFlowSummary`, `SurplusResult`, `AllocationPlan`   |
| Persona + risk recompute  | `POST /api/plan`                    | Same bundle                                            |
| Chart                     | `POST /api/plan` bundle             | `CashFlowSummary.monthlySeries`                        |
| Surplus formula rows      | `POST /api/plan` bundle             | `SurplusResult.breakdownLines`                         |
| Audit grid                | `GET /api/transactions?merchantId=` | `NormalizedTransaction[]`                              |
| Advisor drawer            | `POST /api/advisor`                 | `AdvisorResponse`                                      |
| What-If simulator         | `POST /api/scenario`                | `ScenarioInput` → `ScenarioComparisonResult`           |
| Live updates              | `GET /api/events?merchantId=`       | SSE `AppEvent` (`plan.updated`, `payment.received`, …) |

Every response is parsed with the frozen Zod schema from `@surplus/contracts` before rendering.
Merchant ids are exactly: `live_sandbox`, `persona_steady_retainer`,
`persona_volatile_freelancer`, `persona_seasonal_seller`, `persona_dispute_spike`.

### Persona onboarding

- `live_sandbox` is labelled **Demo Live Sandbox Merchant** and marked `Live`.
- The four `persona_*` rows are marked `Fixture`.
- Selecting a persona resets the obligations input to that persona's default and reloads summary,
  plan, and transactions.
- The obligations field parses dollars into integer cents without floating-point math; invalid input
  is rejected inline and never sent.
- Risk profile changes POST the same merchant + obligations to `/api/plan`.
- The controls never call the engine in the browser.

---

## 3. Dashboard and summary cards

### Top bar

- Brand mark, product name, tagline.
- SSE chip: `Connecting SSE…`, `Live SSE connected`, or `SSE reconnecting…`.
- Live/Fixture pill for the selected merchant.
- **Ask AI Advisor** primary action (disabled until a plan is loaded).

### Hero

- Headline: “Know your safe-to-invest surplus — and see every formula behind it.”
- One-sentence explanation that the LLM narrates and never does math.
- Active merchant card with the persona description.
- Actions: open advisor drawer, refresh data.
- Last live event line; otherwise explains that `/api/events` is connected and waiting.

### Week / month / year cards

Each card uses `CashFlowSummary.windows[window]`:

```
TRAILING 30 DAYS                          [ MONTH ]
This month
$1,184.70
Net cash flow
Sep 1, 2026 – Oct 1, 2026
Gross income      Fees        Refunds      Chargebacks
$1,820.00         $40.00      $400.00      $200.00
Transactions: 4
```

- Money is formatted with `Intl.NumberFormat`; no arithmetic changes a value.
- Negative net cash flow is shown with the formatter's negative sign and a red accent.
- On an SSE event, a **Net Payment Received** ribbon appears above the cards and the three window
  cards flash briefly. The ribbon shows only the event's `deltaNetCents` and timestamp.

### Risk signals card

- Income volatility (`cv`) to four decimals.
- 90-day refund rate (`refundRate90d`) as a percentage.
- Open disputes (`count`, `totalAmountCents`).
- Baseline monthly net (`baselineMonthlyNetCents`).
- Buffer runway (`SurplusResult.bufferMonths`).

---

## 4. Monthly net cash-flow chart

- Input: `CashFlowSummary.monthlySeries` (completed months only).
- Positive bars in teal, negative bars in coral, zero line dashed.
- Y-axis compact currency labels; X-axis month labels.
- Hovering a bar shows month + signed net in a native SVG `<title>`.
- Footer: median monthly net and trend slope per month.
- Expandable **View monthly data table** provides the same values as an accessible table.
- Empty state when there are no completed months.

Implementation note: Recharts is named in the product stack but is not currently in
`apps/web/package.json`. The chart therefore uses an inline SVG with the same data contract. The
component boundary is isolated so the Recharts implementation can replace it without touching the
dashboard. Owner of the dependency change: R1 (package manifest).

---

## 5. Surplus Breakdown

Header: model status badge (`OK`, `INSUFFICIENT_DATA`, `OBLIGATIONS_REQUIRED`,
`NEGATIVE_CASH_FLOW`).

Hero:

```
SAFE-TO-INVEST SURPLUS
$4,200.00
$18,500.00 available − $13,500.00 buffer − $800.00 risk reserve
4.50 months runway · 4 tranches · CV 0.2503 · User obligations
```

Status note explains why a non-OK model holds the surplus at zero.

Formula list (canonical order, exactly 10 lines):

```
01 AVAILABLE_BALANCE            $18,500.00
   availableBalanceCents (source: PAYPAL_REPORTING_API) = 1850000
02 BASELINE_MONTHLY_NET         $1,600.00
   median(monthly net over 12 completed months) = 160000
03 VOLATILITY_CV                0.2503
   round4(sample std dev / max(mean, baseline)) = ...
04 BUFFER_MONTHS                4.50 months
   round2(clamp(3 + 6 * cv, 3, 9)) = ...
05 BUFFER_TARGET                $13,500.00
   round(bufferMonths * monthlyObligationsCents) = ...
06 OPEN_DISPUTE_RESERVE         $400.00
07 EXPECTED_REFUND_EXPOSURE     $400.00
08 TOTAL_RISK_RESERVE           $800.00
09 SAFE_SURPLUS                 $4,200.00
10 STAGED_MONTHLY_TRANCHE       $1,050.00
```

- `BUFFER_TARGET`, `TOTAL_RISK_RESERVE`, and `SAFE_SURPLUS` receive visual emphasis.
- Formula text is rendered verbatim from the engine.
- Staging chips list each `stagingScheduleCents` value by tranche number.
- The card never recalculates or rounds a value.

---

## 6. Transaction audit grid

The product stack requires AG Grid Community (`ag-grid-react`) for the audit table. The current
`apps/web/package.json` does not include AG Grid, so R5 ships an accessible dependency-free grid with
the same required behaviors. Swapping in AG Grid is a component-local change once R1 adds the
dependency; no contract or API change is needed.

### Columns

| Column       | Source             | Behavior                         |
| ------------ | ------------------ | -------------------------------- |
| Date         | `occurredAt`       | Sortable, UTC short date         |
| Month        | `monthBucket`      | Sortable                         |
| Kind         | `kind`             | Filterable pill                  |
| Status       | `status`           | Pill                             |
| Gross        | `grossCents`       | Right-aligned, sortable          |
| Fee          | `feeCents`         | Right-aligned, sortable          |
| Net          | `netCents`         | Right-aligned, signed, green/red |
| Source       | `source`           | `live` / `fixture` pill          |
| Counterparty | `counterpartyHash` | 8-char hash only                 |

### Toolbar and behavior

- Kind filter: all six `TransactionKind` values.
- Quick filter: id, month, kind, or counterparty hash (normalized fields only).
- Client-side sort on every column with `aria-sort`.
- Page size 8 with Previous/Next controls and a row count.
- Empty state: “No transactions in this dataset yet” for an empty live merchant, or “No rows match”
  when filters exclude everything.
- Caption states that free-text PayPal fields are never stored or displayed.

---

## 7. Advisor drawer

Right-side overlay, 720px desktop / full-width mobile. Dismiss with the close button, overlay click,
or Escape. Body scroll locks while open.

```
┌────────────────────────────────────────────────────────────┐
│ Educational advisor                    [Re-run] [×]        │
│ Ask AI Advisor                                             │
│ Balanced · $3,000.00 monthly obligations                   │
├────────────────────────────────────────────────────────────┤
│ [Validator: PASSED] 14 cited metrics · 3 tool calls · time │
│                                                            │
│ Narrative (safe Markdown)                                  │
│                                                            │
│ Grounded numbers [chips]                                   │
│                                                            │
│ Allocation bands                                           │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │ Cash & MMF   │ │ Short bonds  │ │ Broad equity │         │
│ │ 20%–40%      │ │ 20%–40%      │ │ 30%–50%      │         │
│ │ 30% midpoint │ │ 30% midpoint │ │ 40% midpoint │         │
│ │ $1,260.00    │ │ $1,260.00    │ │ $1,680.00    │         │
│ └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                            │
│ Staged allocation                                          │
│ T1 Now $1,050.00 · T2 30d · T3 60d · T4 90d                │
│                                                            │
│ Tool trace (expandable)                                    │
│ ▸ Cash-flow summary      5 ms                              │
│ ▸ Surplus calculation    2 ms                              │
│ ▸ Allocation plan        2 ms                              │
│                                                            │
│ Educational disclaimer + disclaimer id                     │
└────────────────────────────────────────────────────────────┘
```

### Validator badge

| Status               | Label                        | Tone                            |
| -------------------- | ---------------------------- | ------------------------------- |
| `PASSED`             | Validator: PASSED            | Green                           |
| `REGENERATED_PASSED` | Validator: REGENERATED       | Amber                           |
| `FALLBACK_TEMPLATE`  | Validator: FALLBACK TEMPLATE | Blue/info with explanatory note |

If `validatorMismatchesCaught` is non-empty, an expandable panel lists what the validator rejected
before the final response. The UI never hides a fallback status.

### Safety rules in the drawer

- Narrative is rendered by a small Markdown renderer without `dangerouslySetInnerHTML`.
- No ticker, security name, return promise, or “money moved” claim is added by the UI.
- Tool trace shows only `sanitizedOutputSummary` fields (number/string), never raw MCP output.
- The mandatory `disclaimerText` is always rendered at the bottom.
- Allocation and staging are described as illustrative, not executed.

Empty/error states: no trace → explanatory empty panel; advisor request failure → retry panel; while
loading → skeleton.

---

## 8. What-If scenario simulator

```
┌─────────────────────────────────────────────────────────────┐
│ What-If simulator — Stress the surplus                      │
│ POST /api/scenario · computed by @surplus/engine            │
├────────────────────────────┬────────────────────────────────┤
│ Income shock   [-30%]      │  Safe surplus under stress     │
│ ├──────●──────────────┤    │  Baseline $4,200 → $3,840      │
│ -80%      0%      +50%     │  Δ Safe surplus -$360.00       │
│                            │  Δ Buffer runway +0.12 months  │
│ Delayed payment  $0.00     │  Buffer 4.62 months            │
│ One-off expense  $0.00     │  Stressed allocation bands     │
│ [Run stress test]          │  Inputs summary                │
└────────────────────────────┴────────────────────────────────┘
```

- Slider range is exactly -80 to +50 integer percent.
- Delayed payment and one-off expense are entered as dollars and parsed to integer cents.
- Submit builds `ScenarioInput` and calls `POST /api/scenario`.
- Results render `ScenarioComparisonResult` directly:
  - `baselineSurplus.safeSurplusCents` → `stressedSurplus.safeSurplusCents`
  - `deltaSafeSurplusCents`
  - `deltaBufferMonths`
  - stressed buffer, buffer target, risk reserve, tranche count
  - `stressedPlan.bands`
- No delta, stressed buffer, or allocation is calculated in the browser.
- Changing any control clears the previous result and requires another server run.
- Initial empty state explains how to run a test; loading and error states are inline.

---

## 9. Live SSE behavior

1. Dashboard opens `EventSource` on `GET /api/events?merchantId=<selected>`.
2. The status chip shows connecting/open/reconnecting.
3. A frame is parsed with `AppEventSchema`; invalid or foreign-merchant frames are ignored.
4. On a valid event:
   - Replace summary/surplus/plan with `updatedSummary`, `updatedSurplus`, `updatedPlan`.
   - Refresh `/api/plan` and `/api/transactions` with the user's current controls so the event data
     reconciles with the selected obligations/risk profile.
   - Show a bottom-right toast with the event label, `deltaNetCents`, merchant, and timestamp.
   - Flash the week/month/year cards and show the **Net Payment Received** ribbon for payment events.
5. `plan.updated` does not replace an existing business-event toast.
6. No payment, refund, dispute, or plan change is ever synthesized client-side. The toast exists only
   after a validated SSE frame arrives.

---

## 10. State matrix

| Surface         | Loading                    | Empty                               | Error                               | Live                             |
| --------------- | -------------------------- | ----------------------------------- | ----------------------------------- | -------------------------------- |
| Whole dashboard | Skeleton cards/chart/table | —                                   | Full error panel + retry            | Refresh strip during recompute   |
| Summary         | Skeleton                   | N/A                                 | Inline retry banner with stale data | Ribbon + card flash              |
| Chart           | Skeleton                   | “No completed months yet”           | Inline banner via dashboard         | Re-renders from event/refetch    |
| Breakdown       | Skeleton                   | Model-status note (not an error)    | Inline banner                       | Updates from event/refetch       |
| Audit grid      | Row skeleton               | Dataset-empty or filter-empty panel | Inline banner via dashboard         | New normalized row after refetch |
| Advisor         | Drawer skeleton            | Empty trace/plan panel              | Drawer error + retry                | Re-run available                 |
| Scenario        | Result skeleton            | “No stress test yet”                | Inline error                        | N/A                              |

### Responsive breakpoints

- **>1120px:** 4 summary cards; chart + breakdown side by side; scenario split form/result.
- **≤1120px:** 2 summary cards per row; chart and breakdown stack; scenario stacks; persona grid 3-up.
- **≤760px:** top bar compresses; persona grid 2-up; single-column controls/cards; full-width drawer.
- **≤520px:** single-column persona and summary cards; advisor action hidden from the top bar (hero
  actions remain); chart legend hidden.

---

## 11. Accessibility and data safety

- Semantic headings, `section` landmarks, table captions, and `scope` on table headers.
- Sortable headers expose `aria-sort`; controls are real buttons/inputs with labels.
- Drawer is `role="dialog"`, `aria-modal="true"`, labelled, closes on Escape, and focuses the close
  button.
- Live toast uses `role="status"` and `aria-live="polite"`.
- Positive/negative states use text and values, not color alone.
- Reduced-motion media query disables shimmer, flash, drawer, and toast animations.
- No raw PayPal free text exists in any contract row rendered by the UI.
- Money is always integer cents on the wire. `toFixed`/`Intl` are used for display only.
- No secrets, payer emails, names, notes, memos, custom ids, or messages are rendered.

---

## 12. Acceptance checklist mapping

### K-6 — component hierarchy and wireframes

- [x] Dashboard layout and component hierarchy
- [x] Surplus Breakdown formula layout
- [x] Transaction audit grid layout and columns
- [x] Advisor drawer including bands, staging, trace, validator badge
- [x] What-If scenario simulator
- [ ] R6 approval of this document (pending)

### F-10 — dashboard thin slice

- [x] Week/month/year summary cards
- [x] Monthly net cash-flow chart
- [x] Formula-by-formula surplus breakdown
- [x] Auditable transaction grid
- [x] Persona selector covers all four fixtures + `live_sandbox`
- [ ] AG Grid Community dependency + swap (blocked on R1 adding `ag-grid-react`)
- [ ] Recharts dependency + swap (blocked on R1 adding `recharts`)
- [ ] R2 fixture personas/seeder so fixture payloads differ per persona (blocked on R2)

### C-8 — advisor UI, tool trace, scenario, SSE

- [x] Allocation band cards
- [x] Staged allocation table
- [x] Expandable tool trace
- [x] Validator badge with PASSED / REGENERATED / FALLBACK states
- [x] What-If controls POST to `/api/scenario`
- [x] SSE toast + highlight on validated events
- [ ] Real grounded advisor response instead of `FALLBACK_TEMPLATE` stub (blocked on R4 C-2)
- [ ] Real live payment event needs R1 webhook + R2 live dataset/seeding

### H-4 — UI polish

- [x] Loading skeletons and refresh strips
- [x] Empty states for no months, no transactions, no advisor trace, no scenario
- [x] Error states with retry at dashboard, section, and drawer levels
- [x] Responsive layout at 1120 / 760 / 520 px breakpoints
- [x] Reduced-motion support and keyboard/Escape behavior
- [x] Demo-ready visual system using existing dependencies

---

## 13. Cross-owner requests recorded by R5

1. **R1 — `apps/web/package.json`:** add `ag-grid-react` + `ag-grid-community` and `recharts`, then
   swap the isolated `AuditTable` and `CashFlowChart` internals. (No manifest change made by R5.)
2. **R4 — C-2:** wire `runAdvisorTurn` into `buildApp` so the drawer receives grounded narrative,
   non-empty tool trace, and real validator status.
3. **R1 / R2 — live dataset:** ensure webhook recomputation uses the merchant's selected obligations
   and seeded 12-month baseline so event payloads match the demo narrative.
4. **R6:** review and approve this wireframe document.
