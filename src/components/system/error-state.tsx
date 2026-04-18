"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import styles from "@/components/system/error-state.module.css";

type Props = {
  title: string;
  message: string;
  badge?: string;
  tone?: "danger" | "warning" | "neutral";
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  hint?: string;
  fillViewport?: boolean;
};

export function ErrorState({
  title,
  message,
  badge = "System notice",
  tone = "danger",
  detail,
  retryLabel = "Try again",
  onRetry,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  hint,
  fillViewport = true,
}: Props) {
  return (
    <div className={fillViewport ? styles.shell : undefined}>
      <section className={styles.card}>
        <span className={`${styles.badge} ${styles[tone]}`}>
          <AlertTriangle size={14} />
          {badge}
        </span>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>

        {detail ? <div className={styles.detail}>{detail}</div> : null}

        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={styles.primary}>
              <RefreshCw size={16} style={{ marginRight: "0.45rem" }} />
              {retryLabel}
            </button>
          ) : null}

          {primaryHref && primaryLabel ? (
            <Link href={primaryHref} className={onRetry ? styles.secondary : styles.primary}>
              {primaryLabel}
            </Link>
          ) : null}

          {secondaryHref && secondaryLabel ? (
            <Link href={secondaryHref} className={styles.secondary}>
              {secondaryLabel}
            </Link>
          ) : null}
        </div>

        {hint ? <p className={styles.hint}>{hint}</p> : null}
      </section>
    </div>
  );
}
