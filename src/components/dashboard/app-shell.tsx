"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Cpu, Settings, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className={cn(styles.app, isSidebarCollapsed && styles.appCollapsed)}>
      <aside className={cn(styles.sidebar, isSidebarCollapsed && styles.sidebarCollapsed)}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <img src="/icon.svg" alt="GanSystems" className={styles.brandOrb} />
            {!isSidebarCollapsed && (
              <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" }}>GanSystems</h2>
            )}
          </div>
          <button
            className={styles.sidebarToggle}
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
        </div>

        <div className={styles.sidebarContent}>
          <nav className={styles.nav} aria-label="Main navigation">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(styles.navLink, active && styles.navLinkActive)}
                  title={isSidebarCollapsed ? label : undefined}
                >
                  <Icon size={18} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                  {!isSidebarCollapsed && <span>{label}</span>}
                </Link>
              );
            })}
          </nav>

          {!isSidebarCollapsed && (
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
          )}
        </div>

        <div className={styles.account}>
          {!isSidebarCollapsed ? (
            <>
              <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: "0.2rem" }}>{user.name}</strong>
              <p className={styles.muted} style={{ fontSize: "0.8rem", margin: "0 0 0.8rem" }}>{user.email}</p>
              <LogoutButton />
            </>
          ) : (
            <LogoutButton />
          )}
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
