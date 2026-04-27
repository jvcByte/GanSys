"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cpu, AlertTriangle, Droplets, Sprout, Plus, Wifi, WifiOff, Trash2 } from "lucide-react";

import styles from "@/components/dashboard/dashboard.module.css";
import { ScopedErrorBoundary } from "@/components/system/scoped-error-boundary";
import { formatRelativeTime } from "@/lib/utils";
import { useWs } from "@/lib/ws-context";
import type { DashboardSnapshot } from "@/lib/types";

type Props = {
  initialSnapshot: DashboardSnapshot;
};

function statusClass(status: string) {
  if (status === "online") return styles.online;
  if (status === "stale") return styles.stale;
  return styles.offline;
}

function alertClass(severity: string) {
  if (severity === "critical") return styles.alertCritical;
  if (severity === "warning") return styles.alertWarning;
  return styles.alertInfo;
}

export function DashboardHome({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState("");
  const { lastMessage, connected } = useWs();
  const safeSnapshot = {
    user: snapshot?.user ?? initialSnapshot?.user,
    summary: snapshot?.summary ?? initialSnapshot?.summary,
    controllers: snapshot?.controllers ?? initialSnapshot?.controllers ?? [],
    alerts: snapshot?.alerts ?? initialSnapshot?.alerts ?? [],
  };

  // React to real-time controller_update messages from WebSocket
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "controller_update") return;
    setSnapshot((prev) => ({
      ...prev,
      controllers: (prev?.controllers ?? []).map((c) =>
        c.id === lastMessage.data.id ? lastMessage.data : c
      ),
    }));
  }, [lastMessage]);

  // Fallback polling when WebSocket is disconnected
  useEffect(() => {
    if (connected) return;
    const interval = window.setInterval(async () => {
      const response = await fetch("/api/controllers", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as Partial<DashboardSnapshot>;
      setSnapshot((prev) => ({
        user: next.user ?? prev.user,
        summary: next.summary ?? prev.summary,
        controllers: next.controllers ?? prev.controllers,
        alerts: next.alerts ?? prev.alerts,
      }));
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [connected]);

  async function refreshControllers() {
    const response = await fetch("/api/controllers", { cache: "no-store" });
    if (response.ok) {
      const next = (await response.json()) as Partial<DashboardSnapshot>;
      setSnapshot((prev) => ({
        user: next.user ?? prev.user,
        summary: next.summary ?? prev.summary,
        controllers: next.controllers ?? prev.controllers,
        alerts: next.alerts ?? prev.alerts,
      }));
    }
  }

  async function deleteController(controllerId: string, controllerName: string) {
    if (!window.confirm(`Are you sure you want to delete "${controllerName}"? This will remove all channels and data associated with this controller. This action cannot be undone.`)) {
      return;
    }
    
    setMessage("Deleting controller...");
    const response = await fetch(`/api/controllers/${controllerId}`, { method: "DELETE" });
    
    if (response.ok) {
      setMessage("Controller deleted successfully.");
      await refreshControllers();
    } else {
      const data = await response.json();
      setMessage(data.error ?? "Failed to delete controller.");
    }
  }

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Live overview</p>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>{safeSnapshot.user?.farmName ?? "Farm"} dashboard</h1>
          <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
            Monitor controller uptime, water systems, soil signals, and pending field alerts.
          </p>
        </div>
        <div className={styles.actions}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: connected ? "var(--success)" : "var(--muted)" }}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connected ? "Live" : "Polling"}
          </span>
          <Link className={styles.button} href="/dashboard/settings" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Plus size={15} strokeWidth={2.5} /> Add Controller
          </Link>
        </div>
      </header>

      {message && <div className={styles.card} style={{ marginBottom: "1rem" }}>{message}</div>}

      <ScopedErrorBoundary
        badge="Overview metrics"
        title="Overview metrics are unavailable"
        message="The dashboard shell is still active, but the summary cards could not render."
      >
        <section className={styles.section}>
          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted)" }}>
                <Cpu size={14} />
                <p className={styles.eyebrow} style={{ margin: 0 }}>Controllers</p>
              </div>
              <strong>{safeSnapshot.summary?.controllerCount ?? 0}</strong>
              <p className={styles.muted} style={{ margin: 0, fontSize: "0.82rem" }}>
                {safeSnapshot.summary?.onlineControllers ?? 0} online,{" "}
                {(safeSnapshot.summary?.controllerCount ?? 0) - (safeSnapshot.summary?.onlineControllers ?? 0)} offline
              </p>
            </article>
            <article className={styles.summaryCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted)" }}>
                <AlertTriangle size={14} />
                <p className={styles.eyebrow} style={{ margin: 0 }}>Alerts</p>
              </div>
              <strong>{(safeSnapshot.summary?.criticalAlerts ?? 0) + (safeSnapshot.summary?.warningAlerts ?? 0)}</strong>
              <p className={styles.muted} style={{ margin: 0, fontSize: "0.82rem" }}>
                {safeSnapshot.summary?.criticalAlerts ?? 0} critical, {safeSnapshot.summary?.warningAlerts ?? 0} warning{(safeSnapshot.summary?.warningAlerts ?? 0) === 1 ? "" : "s"}
              </p>
            </article>
            <article className={styles.summaryCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted)" }}>
                <Droplets size={14} />
                <p className={styles.eyebrow} style={{ margin: 0 }}>Tank Average</p>
              </div>
              <strong>{safeSnapshot.summary?.avgTankLevel ?? "--"}%</strong>
              <p className={styles.muted} style={{ margin: 0, fontSize: "0.82rem" }}>Across registered tank channels</p>
            </article>
            <article className={styles.summaryCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted)" }}>
                <Sprout size={14} />
                <p className={styles.eyebrow} style={{ margin: 0 }}>Soil Average</p>
              </div>
              <strong>{safeSnapshot.summary?.avgSoilMoisture ?? "--"}%</strong>
              <p className={styles.muted} style={{ margin: 0, fontSize: "0.82rem" }}>
                {safeSnapshot.summary?.openCommands ?? 0} manual command{(safeSnapshot.summary?.openCommands ?? 0) === 1 ? "" : "s"} pending
              </p>
            </article>
          </div>
        </section>
      </ScopedErrorBoundary>

      <section className={styles.metricGrid}>
        <ScopedErrorBoundary
          badge="Controller fleet"
          title="Controller inventory could not render"
          message="The dashboard is still available, but the controller list failed in this section."
        >
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Cpu size={16} style={{ color: "var(--muted)" }} />
                <div>
                  <p className={styles.eyebrow}>Controllers</p>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>ESP32 fleet</h2>
                </div>
              </div>
            </div>

            <div className={styles.controllerGrid}>
              {safeSnapshot.controllers.length ? (
                safeSnapshot.controllers.map((controller) => (
                  <article key={controller.id} className={styles.controllerCard}>
                    <div className={styles.cardHead}>
                      <div>
                        <p className={styles.eyebrow}>{controller.location}</p>
                        <h3>{controller.name}</h3>
                        <p className={styles.muted}>
                          {controller.hardwareId} / Last seen {formatRelativeTime(controller.lastSeenAt)}
                        </p>
                      </div>
                      <span className={`${styles.status} ${statusClass(controller.status)}`}>{controller.status}</span>
                    </div>

                    <div className={styles.tags}>
                      <span className={styles.tag}>{controller.channelCount} channels</span>
                      <span className={styles.tag}>{controller.sensorCount} sensors</span>
                      <span className={styles.tag}>{controller.actuatorCount} actuators</span>
                      <span className={styles.tag}>{controller.openAlertCount} open alerts</span>
                    </div>

                    <p className={styles.muted}>{controller.description || "No description yet."}</p>

                    <div className={styles.rowBetween}>
                      <div className={styles.muted}>
                        <strong>{controller.firmwareVersion}</strong>
                        <div className={styles.small}>Firmware</div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <Link className={styles.button} href={`/dashboard/controllers/${controller.id}`}>
                          Open Controller
                        </Link>
                        <button
                          className={styles.dangerButton}
                          type="button"
                          onClick={() => void deleteController(controller.id, controller.name)}
                          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>No controllers yet. Open Settings to register your first ESP32.</div>
              )}
            </div>
          </div>
        </ScopedErrorBoundary>

        <ScopedErrorBoundary
          badge="Alert feed"
          title="Open alerts could not render"
          message="The alert panel failed, but the rest of the dashboard is still available."
        >
          <aside className={styles.section}>
            <div className={styles.sectionHead}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <AlertTriangle size={16} style={{ color: "var(--muted)" }} />
                <div>
                  <p className={styles.eyebrow}>Attention</p>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Open alerts</h2>
                </div>
              </div>
            </div>
            <div className={styles.alertList}>
              {safeSnapshot.alerts.length ? (
                safeSnapshot.alerts.map((alert) => (
                  <article key={alert.id} className={`${styles.alertCard} ${alertClass(alert.severity)}`}>
                    <div className={styles.rowBetween}>
                      <strong>{alert.title}</strong>
                      <span className={styles.muted}>{alert.severity}</span>
                    </div>
                    <p className={styles.muted}>{alert.message}</p>
                    <p className={styles.small}>{formatRelativeTime(alert.openedAt)}</p>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>No open alerts. The current dashboard state is stable.</div>
              )}
            </div>
          </aside>
        </ScopedErrorBoundary>
      </section>
    </>
  );
}
