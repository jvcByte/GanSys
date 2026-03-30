"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "@/components/dashboard/dashboard.module.css";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className={styles.ghostButton} type="button" onClick={handleLogout} disabled={loading}>
      {loading ? "Signing out..." : "Log Out"}
    </button>
  );
}
