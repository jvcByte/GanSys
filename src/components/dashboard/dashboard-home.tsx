"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cpu, AlertTriangle, Plus, Wifi, WifiOff, Trash2 } from "lucide-react";

import styles from "@/components/dashboard/dashboard.module.css";
import { ScopedErrorBoundary } from "@/components/system/scoped-error-boundary";
import { formatRelativeTime } from "@/lib/utils";
import { useWs } from "@/lib/ws-context";
import { apiFetch } from "@/lib/api-client";
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
    let active = true;
    let seq = 0;
    const controller = new AbortController();
    const interval = window.setInterval(async () => {
      const mySeq = ++seq;
      try {
        const response = await fetch("/api/controllers", { cache: "no-store", signal: controller.signal });
        if (!response.ok || !active || mySeq !== seq) return;
        const next = (await response.json()) as Partial<DashboardSnapshot>;
        setSnapshot((prev) => ({
          user: next.user ?? prev.user,
          summary: next.summary ?? prev.summary,
          controllers: next.controllers ?? prev.controllers,
          alerts: next.alerts ?? prev.alerts,
        }));
      } catch {
        // Ignore transient network errors; keep the current data.
      }
    }, 5_000);
    return () => { active = false; window.clearInterval(interval); controller.abort(); };
  }, [connected]);

  async function refreshControllers() {
    try {
      const next = await apiFetch<Partial<DashboardSnapshot>>("/api/controllers", { cache: "no-store" });
      setSnapshot((prev) => ({
        user: next.user ?? prev.user,
        summary: next.summary ?? prev.summary,
        controllers: next.controllers ?? prev.controllers,
        alerts: next.alerts ?? prev.alerts,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to refresh controllers.");
    }
  }

  async function deleteController(controllerId: string, controllerName: string) {
    if (!window.confirm(`Are you sure you want to delete "${controllerName}"? This will remove all channels and data associated with this controller. This action cannot be undone.`)) {
      return;
    }
    
    setMessage("Deleting controller...");
    try {
      await apiFetch(`/api/controllers/${controllerId}`, { method: "DELETE" });
      setMessage("Controller deleted successfully.");
      await refreshControllers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete controller.");
    }
  }

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Welcome</p>
          <h1>{safeSnapshot.user?.farmName ?? "Farm"}</h1>
          <p className={styles.muted} style={{ marginTop: "0.25rem", fontSize: "0.9rem" }}>
            Real-time monitoring of controllers, sensors, and irrigation systems
          </p>
        </div>
        <div className={styles.actions}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", color: connected ? "var(--success)" : "var(--muted)" }}>
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
            {connected ? "Live" : "Polling"}
          </span>
          <Link className={styles.button} href="/dashboard/settings" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Plus size={16} /> Add Controller
          </Link>
        </div>
      </header>

      {message && (
        <div className={styles.card} style={{ marginBottom: "1.5rem", padding: "1rem" }}>
          <p style={{ margin: 0 }}>{message}</p>
        </div>
      )}

      <ScopedErrorBoundary
        badge="Overview"
        title="Overview unavailable"
        message="The summary metrics could not load, but the controller list is still available."
      >
        <section className={styles.section} style={{ marginBottom: "2rem" }}>
          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <p className={styles.eyebrow}>Controllers</p>
              <strong>{safeSnapshot.summary?.controllerCount ?? 0}</strong>
              <p className={styles.muted}>
                {safeSnapshot.summary?.onlineControllers ?? 0} online
              </p>
            </article>
            <article className={styles.summaryCard}>
              <p className={styles.eyebrow}>Alerts</p>
              <strong>{(safeSnapshot.summary?.criticalAlerts ?? 0) + (safeSnapshot.summary?.warningAlerts ?? 0)}</strong>
              <p className={styles.muted}>
                {safeSnapshot.summary?.criticalAlerts ?? 0} critical
              </p>
            </article>
            <article className={styles.summaryCard}>
              <p className={styles.eyebrow}>Tank Level</p>
              <strong>{safeSnapshot.summary?.avgTankLevel ?? "--"}%</strong>
              <p className={styles.muted}>Average</p>
            </article>
            <article className={styles.summaryCard}>
              <p className={styles.eyebrow}>Soil Moisture</p>
              <strong>{safeSnapshot.summary?.avgSoilMoisture ?? "--"}%</strong>
              <p className={styles.muted}>Average</p>
            </article>
          </div>
        </section>
      </ScopedErrorBoundary>

      <section className={styles.metricGrid}>
        <ScopedErrorBoundary
          badge="Controllers"
          title="Controllers unavailable"
          message="The controller list could not load, but the rest of the dashboard is available."
        >
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>Inventory</p>
                <h2 style={{ margin: "0.3rem 0 0", fontSize: "1.2rem", fontWeight: 600 }}>ESP32 Controllers</h2>
              </div>
            </div>

            <div className={styles.controllerGrid}>
              {safeSnapshot.controllers.length ? (
                safeSnapshot.controllers.map((controller) => (
                  <article key={controller.id} className={styles.controllerCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem" }}>
                      <div>
                        <p className={styles.eyebrow}>{controller.location}</p>
                        <h3 style={{ margin: 0 }}>{controller.name}</h3>
                        <p className={styles.muted} style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                          {controller.hardwareId}
                        </p>
                      </div>
                      <span className={`${styles.status} ${statusClass(controller.status)}`}>{controller.status}</span>
                    </div>

                    <div className={styles.tags}>
                      <span className={styles.tag}>{controller.channelCount} channels</span>
                      <span className={styles.tag}>{controller.sensorCount} sensors</span>
                      <span className={styles.tag}>{controller.actuatorCount} actuators</span>
                    </div>

                    <p className={styles.muted} style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                      {controller.description || "—"}
                    </p>

                    <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
                      <Link className={styles.button} href={`/dashboard/controllers/${controller.id}`} style={{ flex: 1 }}>
                        Open
                      </Link>
                      <button
                        className={styles.dangerButton}
                        type="button"
                        onClick={() => void deleteController(controller.id, controller.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className={styles.empty} style={{ gridColumn: "1 / -1" }}>
                  No controllers registered yet
                </div>
              )}
            </div>
          </div>
        </ScopedErrorBoundary>

        <ScopedErrorBoundary
          badge="Alerts"
          title="Alerts unavailable"
          message="The alert panel could not load, but the rest of the dashboard is available."
        >
          <aside className={styles.section}>
            <div>
              <p className={styles.eyebrow}>Status</p>
              <h2 style={{ margin: "0.3rem 0 1rem", fontSize: "1.2rem", fontWeight: 600 }}>Recent Alerts</h2>
            </div>
            <div className={styles.alertList}>
              {safeSnapshot.alerts.length ? (
                safeSnapshot.alerts.map((alert) => (
                  <article key={alert.id} className={`${styles.alertCard} ${alertClass(alert.severity)}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", marginBottom: "0.3rem" }}>
                      <strong style={{ fontSize: "0.95rem" }}>{alert.title}</strong>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)" }}>{alert.severity}</span>
                    </div>
                    <p className={styles.muted} style={{ margin: "0.2rem 0 0.3rem", fontSize: "0.85rem" }}>{alert.message}</p>
                    <p className={styles.small} style={{ margin: 0 }}>{formatRelativeTime(alert.openedAt)}</p>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>All systems nominal</div>
              )}
            </div>
          </aside>
        </ScopedErrorBoundary>
      </section>
    </>
  );
}
