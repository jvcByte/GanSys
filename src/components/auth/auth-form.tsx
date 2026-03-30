"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "@/components/auth/auth-form.module.css";

type Mode = "login" | "signup";

type Props = {
  mode: Mode;
};

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
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

    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Authentication failed.");
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.badge}>Nigerian Engineering Olympiad 2026</div>
        <h1 className={styles.title}>GanSystems control dashboard for water, soil, and aquaculture.</h1>
        <p className={styles.copy}>
          Monitor solar-powered irrigation assets, attach ESP32 controllers, register sensors, and manage field automation from one lightweight
          workspace.
        </p>
        <div className={styles.grid}>
          <article className={styles.statCard}>
            <p className={styles.eyebrow}>Tank</p>
            <strong>68%</strong>
            <span>Live reservoir tracking with threshold alerts.</span>
          </article>
          <article className={styles.statCard}>
            <p className={styles.eyebrow}>Soil</p>
            <strong>47%</strong>
            <span>Precision irrigation visibility for every crop zone.</span>
          </article>
          <article className={styles.statCard}>
            <p className={styles.eyebrow}>Control</p>
            <strong>ESP32</strong>
            <span>Per-user controller and actuator management.</span>
          </article>
        </div>
      </section>

      <section className={styles.panel}>
        <p className={styles.eyebrow}>{mode === "login" ? "Access Dashboard" : "Create Account"}</p>
        <h2>{mode === "login" ? "Sign in to GanSystems" : "Start a new GanSystems workspace"}</h2>
        <form
          className={styles.form}
          action={async (formData) => {
            await handleSubmit(formData);
          }}
        >
          {mode === "signup" ? (
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
          ) : (
            <label className={styles.row}>
              <span>Email</span>
              <input name="email" type="email" placeholder="demo@gansys.app" required />
            </label>
          )}

          {mode === "login" ? (
            <label className={styles.row}>
              <span>Password</span>
              <input name="password" type="password" placeholder="Enter your password" required />
            </label>
          ) : (
            <label className={styles.row}>
              <span>Password</span>
              <input name="password" type="password" placeholder="At least 6 characters" minLength={6} required />
            </label>
          )}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>
        <p className={styles.subtle}>Demo account: demo@gansys.app / demo1234</p>
        <p className={styles.message}>{error}</p>
        <div className={styles.links}>
          {mode === "login" ? <a href="/signup">Need an account? Sign up</a> : <a href="/login">Already have an account? Log in</a>}
        </div>
      </section>
    </div>
  );
}
