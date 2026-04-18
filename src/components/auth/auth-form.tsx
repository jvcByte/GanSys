"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "@/components/auth/auth-form.module.css";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Read form data synchronously before any await
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setError("");
    const payload =
      mode === "login"
        ? {
            email: String(formData.get("email") ?? ""),
            password: String(formData.get("password") ?? ""),
          }
        : {
            name: String(formData.get("name") ?? ""),
            farmName: String(formData.get("farmName") ?? ""),
            location: String(formData.get("location") ?? ""),
            email: String(formData.get("email") ?? ""),
            password: String(formData.get("password") ?? ""),
          };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Authentication failed.");
        setLoading(false);
        return;
      }

      // Force a document navigation so the new server-set session cookie is
      // definitely present for the dashboard request.
      window.location.assign("/dashboard");
    } catch {
      setError("Authentication failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* Left — branding */}
      <aside className={styles.brand}>
        <div className={styles.brandTop}>
          <img src="/icon.svg" alt="GanSystems logo" className={styles.brandOrb} />
          <span className={styles.brandName}>GanSystems</span>
        </div>

        <div className={styles.brandBody}>
          <span className={styles.brandBadge}>NEO 2026 · Veritas University</span>
          <h1 className={styles.brandTitle}>
            Farm Intelligence<br />
            <span className={styles.brandAccent}>at your fingertips</span>
          </h1>
          <p className={styles.brandCopy}>
            Monitor irrigation, aquaculture, water supply, weed detection, and pest control
            from a single solar-powered IoT dashboard.
          </p>
          <div className={styles.brandStats}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Tank</p>
              <strong>68%</strong>
              <span>Live reservoir tracking</span>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Soil</p>
              <strong>47%</strong>
              <span>Precision irrigation</span>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>ESP32</p>
              <strong>Online</strong>
              <span>Controller fleet</span>
            </div>
          </div>
        </div>

        <p className={styles.brandFooter}>© 2026 GanSystems · Nigerian Engineering Olympiad</p>
      </aside>

      {/* Right — form */}
      <div className={styles.formPanel}>
        <div className={styles.formInner}>
          <p className={styles.eyebrow}>{mode === "login" ? "Welcome back" : "Get started"}</p>
          <h2 className={styles.formTitle}>
            {mode === "login" ? "Sign in to GanSystems" : "Create your workspace"}
          </h2>

          <form className={styles.form} onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(e);
          }}>
            {mode === "signup" && (
              <>
                <label className={styles.row}>
                  <span>Full name</span>
                  <input name="name" placeholder="Onah Maxwell" required />
                </label>
                <label className={styles.row}>
                  <span>Farm name</span>
                  <input name="farmName" placeholder="Veritas Demo Farm" required />
                </label>
                <div className={styles.two}>
                  <label className={styles.row}>
                    <span>Location</span>
                    <input name="location" placeholder="Abuja, Nigeria" required />
                  </label>
                  <label className={styles.row}>
                    <span>Email</span>
                    <input name="email" type="email" placeholder="you@example.com" required />
                  </label>
                </div>
              </>
            )}

            {mode === "login" && (
              <label className={styles.row}>
                <span>Email</span>
                <input name="email" type="email" placeholder="demo@gansys.app" required />
              </label>
            )}

            <label className={styles.row}>
              <span>Password</span>
              <input name="password" type="password" placeholder={mode === "login" ? "Enter your password" : "At least 6 characters"} minLength={6} required />
            </label>

            <button className={styles.button} type="submit" disabled={loading}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          {mode === "login" && (
            <p className={styles.subtle}>Demo: demo@gansys.app / demo1234</p>
          )}

          <p className={styles.message}>{error}</p>

          <p className={styles.links}>
            {mode === "login"
              ? <Link href="/signup">Don&apos;t have an account? Sign up</Link>
              : <Link href="/login">Already have an account? Sign in</Link>}
          </p>
        </div>
      </div>
    </div>
  );
}
