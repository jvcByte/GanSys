import Link from "next/link";
import type { ControllerCard } from "@/lib/types";
import styles from "@/components/dashboard/dashboard.module.css";

type Props = {
  controller: ControllerCard;
  onComplete: () => void;
};

export function DeviceConnectedState({ controller, onComplete }: Props) {
  return (
    <div className={styles.card} style={{ textAlign: "center", padding: "3rem" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
      <h2 style={{ margin: "0.5rem 0 0.5rem" }}>Your device is connected!</h2>
      <p className={styles.muted} style={{ marginBottom: "2rem" }}>
        {controller.name}
      </p>

      <div className={styles.card} style={{ 
        background: "var(--primary-dim)", 
        marginBottom: "2rem",
        padding: "1.5rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
          <span className={`${styles.status} ${styles.online}`}>Connected</span>
        </div>
        <p className={styles.muted} style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
          Your device is communicating with the farm dashboard
        </p>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        <Link 
          className={styles.button} 
          href={`/dashboard/controllers/${controller.id}`}
          style={{ display: "block", textAlign: "center" }}
        >
          View device
        </Link>
        <button
          className={styles.ghostButton}
          onClick={onComplete}
          style={{ width: "100%" }}
        >
          Add another device
        </button>
        <Link
          className={styles.ghostButton}
          href="/dashboard"
          style={{ display: "block", textAlign: "center" }}
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}