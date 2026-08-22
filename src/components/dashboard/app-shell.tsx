"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Cpu, Settings, LogOut } from "lucide-react";

import styles from "@/components/dashboard/dashboard.module.css";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";

type Props = {
  user: SessionUser;
  children: React.ReactNode;
};

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/controllers", label: "Controllers", icon: Cpu, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: true },
];

export function AppShell({ user, children }: Props) {
  const pathname = usePathname();

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div>
          <div className={styles.brand}>
            <img src="/icon.svg" alt="GanSystems" className={styles.brandOrb} />
            <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" }}>GanSystems</h2>
          </div>

          <nav className={styles.nav} aria-label="Main navigation">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(styles.navLink, active && styles.navLinkActive)}
                >
                  <Icon size={18} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <p className={styles.muted} style={{ margin: "0", fontSize: "0.8rem" }}>Farm</p>
              <strong>{user.farmName}</strong>
            </div>
            <div className={styles.miniStat}>
              <p className={styles.muted} style={{ margin: "0", fontSize: "0.8rem" }}>Location</p>
              <strong>{user.location}</strong>
            </div>
          </div>
        </div>

        <div className={styles.account}>
          <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: "0.2rem" }}>{user.name}</strong>
          <p className={styles.muted} style={{ fontSize: "0.8rem", margin: "0 0 0.8rem" }}>{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
