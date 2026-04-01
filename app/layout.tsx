import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "GanSystems Dashboard",
  description: "Solar-powered smart water and irrigation management dashboard for GanSystems.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.NODE_ENV !== "production" || process.env.SEED_DEMO_DATA === "true") {
    const { seedDemoData } = await import("@/lib/data");
    seedDemoData();
  }

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
