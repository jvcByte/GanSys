import type { Metadata } from "next";

import { seedDemoData } from "@/lib/data";

import "./globals.css";

export const metadata: Metadata = {
  title: "GanSystems Dashboard",
  description: "Solar-powered smart water and irrigation management dashboard for GanSystems.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  seedDemoData();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
