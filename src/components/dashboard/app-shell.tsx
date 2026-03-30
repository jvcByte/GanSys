"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "@/components/dashboard/dashboard.module.css";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";

type Props = {
  user: SessionUser;
  children: React.ReactNode;
};

export function AppShell({ user, children }: Props) {
  const pathname = usePathname();

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div>
          <div className={styles.brand}>
            <div className={styles.brandOrb} />
            <div>
              <p className={styles.eyebrow}>GanSystems</p>
              <h2>Control Hub</h2>
            </div>
          </div>

          <nav className={styles.nav} aria-label="Dashboard navigation">
            <Link className={cn(styles.navLink, pathname === "/dashboard" && styles.navLinkActive)} href="/dashboard">
              Overview
            </Link>
            <Link
              className={cn(styles.navLink, pathname.startsWith("/dashboard/controllers") && styles.navLinkActive)}
              href="/dashboard"
            >
              Controllers
            </Link>
            <Link className={cn(styles.navLink, pathname === "/dashboard/settings" && styles.navLinkActive)} href="/dashboard/settings">
              Settings
            </Link>
          </nav>

          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <span className={styles.muted}>Farm</span>
              <strong>{user.farmName}</strong>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.muted}>Location</span>
              <strong>{user.location}</strong>
            </div>
          </div>
        </div>

        <div className={styles.account}>
          <strong>{user.name}</strong>
          <p className={styles.muted}>{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
