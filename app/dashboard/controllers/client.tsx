"use client";

import Link from "next/link";
import { useState } from "react";
import { Cpu, Trash2 } from "lucide-react";

import styles from "@/components/dashboard/dashboard.module.css";
import { formatRelativeTime } from "@/lib/utils";
import type { DashboardSnapshot } from "@/lib/types";

function statusClass(status: string) {
  if (status === "online") return styles.online;
  if (status === "stale") return styles.stale;
  return styles.offline;
}

type Props = {
  initialSnapshot: DashboardSnapshot;
};

export function ControllersPageClient({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState("");

  async function refreshControllers() {
    const response = await fetch("/api/controllers", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as DashboardSnapshot;
      setSnapshot(data);
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
          <p className={styles.eyebrow}>Controller directory</p>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>Registered ESP32 controllers</h1>
          <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
            Browse every controller connected to your dashboard and jump straight into a device detail view.
          </p>
        </div>
      </header>

      {message && <div className={styles.card} style={{ marginBottom: "1rem" }}>{message}</div>}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Cpu size={16} style={{ color: "var(--muted)" }} />
            <div>
              <p className={styles.eyebrow}>Controllers</p>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                {snapshot.controllers.length} registered controller{snapshot.controllers.length === 1 ? "" : "s"}
              </h2>
            </div>
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
      </section>
    </>
  );
}
