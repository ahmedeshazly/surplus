"use client";

// Owner: R5. Transaction audit grid over NormalizedTransaction[].
// The product stack calls for AG Grid Community; apps/web does not yet include
// ag-grid-react, so this dependency-free grid keeps the audit surface working
// with sorting, filtering, and paging until R1 adds that dependency.
import { useEffect, useMemo, useState } from "react";
import type { NormalizedTransaction, TransactionKind } from "@surplus/contracts";
import { TransactionKindSchema } from "@surplus/contracts";
import {
  formatCents,
  formatIsoDate,
  formatMonthBucket,
  formatSignedCents,
  formatTransactionKind,
} from "@/lib/format";
import { EmptyPanel } from "./ui";

const PAGE_SIZE = 8;

type SortKey =
  | "occurredAt"
  | "monthBucket"
  | "kind"
  | "status"
  | "grossCents"
  | "feeCents"
  | "netCents"
  | "source"
  | "counterpartyHash";

type SortDirection = "asc" | "desc";

interface AuditTableProps {
  transactions: NormalizedTransaction[] | null;
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "occurredAt", label: "Date" },
  { key: "monthBucket", label: "Month" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status" },
  { key: "grossCents", label: "Gross", numeric: true },
  { key: "feeCents", label: "Fee", numeric: true },
  { key: "netCents", label: "Net", numeric: true },
  { key: "source", label: "Source" },
  { key: "counterpartyHash", label: "Counterparty" },
];

function compareRows(
  left: NormalizedTransaction,
  right: NormalizedTransaction,
  key: SortKey,
): number {
  const leftValue = left[key];
  const rightValue = right[key];
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }
  return String(leftValue).localeCompare(String(rightValue));
}

export function AuditTable({ transactions }: AuditTableProps) {
  const [kindFilter, setKindFilter] = useState<"all" | TransactionKind>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("occurredAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const all = transactions ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = all.filter((tx) => {
      if (kindFilter !== "all" && tx.kind !== kindFilter) return false;
      if (needle.length === 0) return true;
      return (
        tx.id.toLowerCase().includes(needle) ||
        tx.counterpartyHash.includes(needle) ||
        tx.monthBucket.includes(needle) ||
        tx.kind.includes(needle)
      );
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const primary = compareRows(left, right, sortKey) * direction;
      return primary !== 0 ? primary : left.id.localeCompare(right.id);
    });
  }, [transactions, kindFilter, query, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [kindFilter, query, sortKey, sortDirection]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);
  const filtersActive = kindFilter !== "all" || query.trim().length > 0;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "occurredAt" || key.endsWith("Cents") ? "desc" : "asc");
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  }

  function clearFilters() {
    setKindFilter("all");
    setQuery("");
  }

  return (
    <section className="card table-card" aria-labelledby="audit-title">
      <div className="card-head card-head--wrap">
        <div>
          <p className="card-kicker">Audit trail</p>
          <h2 className="card-title" id="audit-title">
            Normalized transaction grid
          </h2>
          <p className="card-sub">
            GET /api/transactions ·{" "}
            {transactions === null ? "loading" : `${transactions.length} rows`} · PayPal free text
            is never stored or displayed
          </p>
        </div>
        <div className="table-toolbar">
          <div className="toolbar-field">
            <label className="toolbar-label" htmlFor="audit-kind">
              Kind
            </label>
            <select
              id="audit-kind"
              className="select"
              value={kindFilter}
              onChange={(event) => {
                const value = event.target.value;
                setKindFilter(value === "all" ? "all" : TransactionKindSchema.parse(value));
              }}
            >
              <option value="all">All kinds</option>
              {TransactionKindSchema.options.map((kind) => (
                <option value={kind} key={kind}>
                  {formatTransactionKind(kind)}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar-field toolbar-field--search">
            <label className="toolbar-label" htmlFor="audit-search">
              Quick filter
            </label>
            <input
              id="audit-search"
              className="select"
              type="search"
              value={query}
              placeholder="id, month, kind, hash…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filtersActive ? (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={clearFilters}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {transactions === null ? (
        <div className="table-skeleton" aria-busy="true" aria-label="Loading transactions">
          {[0, 1, 2, 3].map((index) => (
            <span className="skeleton skeleton--row" key={index} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyPanel
          title={
            transactions.length === 0 ? "No transactions in this dataset yet" : "No rows match"
          }
        >
          {transactions.length === 0 ? (
            <p>
              Live Sandbox starts empty. Verified <code>PAYMENT.CAPTURE.COMPLETED</code> webhooks
              appear here as normalized rows, never as raw PayPal payloads.
            </p>
          ) : (
            <p>Adjust the kind filter or quick filter to see more rows.</p>
          )}
          {filtersActive ? (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </EmptyPanel>
      ) : (
        <>
          <div className="audit-grid-wrap">
            <table className="audit-table">
              <caption className="sr-only">
                Normalized PayPal transactions with sortable columns and client-side filtering
              </caption>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={ariaSort(column.key)}
                      className={column.numeric ? "numeric" : undefined}
                    >
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        <span className="sort-indicator" aria-hidden="true">
                          {sortKey === column.key ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((tx) => (
                  <tr key={tx.id}>
                    <td className="mono">{formatIsoDate(tx.occurredAt)}</td>
                    <td className="nowrap">{formatMonthBucket(tx.monthBucket)}</td>
                    <td>
                      <span className={`kind-pill kind-pill--${tx.kind}`}>
                        {formatTransactionKind(tx.kind)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${tx.status.toLowerCase()}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="numeric mono">{formatCents(tx.grossCents)}</td>
                    <td className="numeric mono">{formatCents(tx.feeCents)}</td>
                    <td className={`numeric mono ${tx.netCents >= 0 ? "positive" : "negative"}`}>
                      {formatSignedCents(tx.netCents)}
                    </td>
                    <td>
                      <span className={`source-pill source-pill--${tx.source}`}>{tx.source}</span>
                    </td>
                    <td className="mono muted-cell" title={tx.counterpartyHash}>
                      {tx.counterpartyHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <p>
              Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, rows.length)} of{" "}
              {rows.length}
            </p>
            <div className="pager">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span>
                Page {page} / {pageCount}
              </span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
