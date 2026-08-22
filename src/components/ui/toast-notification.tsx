"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from "lucide-react";
import styles from "./toast-notification.module.css";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastNotification({
  message,
  type = "info",
  duration = 4000,
  onClose,
}: {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}) {
  const [isVisible, setIsVisible] = useState(true);
  const Icon = iconMap[type];

  useEffect(() => {
    if (duration === 0) return;
    
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  return (
    <div className={`${styles.toast} ${styles[`toast-${type}`]}`}>
      <div className={styles.toastContent}>
        <Icon className={styles.toastIcon} size={20} />
        <p className={styles.toastMessage}>{message}</p>
      </div>
      <button
        className={styles.toastClose}
        onClick={() => {
          setIsVisible(false);
          onClose?.();
        }}
        aria-label="Close notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}
