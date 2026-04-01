"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    let isActive = true;

    async function resolveTarget() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!isActive) {
          return;
        }

        if (!response.ok) {
          router.replace("/login");
          return;
        }

        const data = (await response.json()) as { user: unknown | null };
        router.replace(data.user ? "/dashboard" : "/login");
      } catch {
        if (isActive) {
          router.replace("/login");
        }
      }
    }

    void resolveTarget();

    return () => {
      isActive = false;
    };
  }, [router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div>
        <p>Redirecting...</p>
        <p>
          <Link href="/login">Continue</Link>
        </p>
      </div>
    </main>
  );
}
