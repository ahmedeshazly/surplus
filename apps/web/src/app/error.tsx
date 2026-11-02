"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log only the digest and message; contract responses never include free text.
    console.error("Surplus dashboard error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="app-shell">
      <main className="page state-page">
        <ErrorPanel
          message="An unexpected client error stopped the dashboard from rendering. No data was changed."
          onRetry={reset}
        />
      </main>
    </div>
  );
}
