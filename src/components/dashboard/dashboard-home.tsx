"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/components/dashboard/dashboard.module.css";
import { formatRelativeTime } from "@/lib/utils";
import type { DashboardSnapshot } from "@/lib/types";

type Props = {
  initialSnapshot: DashboardSnapshot;
};

function statusClass(status: string) {
  if (status === "online") {
    return styles.online;
  }
  if (status === "stale") {
    return styles.stale;
  }
  return styles.offline;
}

function alertClass(severity: string) {
  if (severity === "critical") {
    return styles.alertCritical;
  }
  if (severity === "warning") {
    return styles.alertWarning;
  }
  return styles.alertInfo;
}

export function DashboardHome({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const response = await fetch("/api/controllers", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as DashboardSnapshot;
      setSnapshot(data);
    }, 10_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Live overview</p>
          <h1>{snapshot.user.farmName} dashboard</h1>
          <p className={styles.muted}>Monitor controller uptime, water systems, soil signals, and pending field alerts.</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.button} href="/dashboard/settings">
            Add Controller
          </Link>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.summaryGrid}>
          <article className={styles.card}>
            <p className={styles.eyebrow}>Controllers</p>
            <strong>{snapshot.summary.controllerCount}</strong>
            <span className={styles.muted}>{snapshot.summary.onlineControllers} online right now</span>
          </article>
          <article className={styles.card}>
            <p className={styles.eyebrow}>Alerts</p>
            <strong>{snapshot.summary.criticalAlerts}</strong>
            <span className={styles.muted}>{snapshot.summary.warningAlerts} warnings still open</span>
          </article>
          <article className={styles.card}>
            <p className={styles.eyebrow}>Tank Average</p>
            <strong>{snapshot.summary.avgTankLevel ?? "--"}%</strong>
            <span className={styles.muted}>Across registered tank channels</span>
          </article>
          <article className={styles.card}>
            <p className={styles.eyebrow}>Soil Average</p>
            <strong>{snapshot.summary.avgSoilMoisture ?? "--"}%</strong>
            <span className={styles.muted}>{snapshot.summary.openCommands} manual commands pending</span>
          </article>
        </div>
      </section>

      <section className={styles.metricGrid}>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>Controllers</p>
              <h2>ESP32 fleet</h2>
            </div>
          </div>

          <div className={styles.controllerGrid}>
            {snapshot.controllers.length ? (
              snapshot.controllers.map((controller) => (
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
                    <Link className={styles.button} href={`/dashboard/controllers/${controller.id}`}>
                      Open Controller
                    </Link>
                  </div>
                </article>
              ))
            ) : (
              <div className={styles.empty}>No controllers yet. Open Settings to register your first ESP32.</div>
            )}
          </div>
        </div>

        <aside className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>Attention</p>
              <h2>Open alerts</h2>
            </div>
          </div>
          <div className={styles.alertList}>
            {snapshot.alerts.length ? (
              snapshot.alerts.map((alert) => (
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
      </section>
    </>
  );
}
