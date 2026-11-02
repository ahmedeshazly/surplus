import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Surplus — Treasury runway, explained",
  description:
    "An explainable treasury runway and idle-cash allocation advisor for PayPal-paid freelancers and small merchants.",
};

export const viewport: Viewport = {
  themeColor: "#0b2f2a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
