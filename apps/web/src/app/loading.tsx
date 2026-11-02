import { DashboardSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="app-shell">
      <main className="page page--loading">
        <p className="section-kicker">Surplus</p>
        <h1 className="hero-title">Loading the deterministic dashboard…</h1>
        <DashboardSkeleton />
      </main>
    </div>
  );
}
