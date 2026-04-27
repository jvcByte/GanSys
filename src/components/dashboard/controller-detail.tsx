"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, Bell, Bug, Calendar, Camera,
  ChevronRight, Clock, Cpu, Droplets, Fish, FlaskConical,
  History, Leaf, Settings, Sprout, Sun, ToggleLeft,
  ToggleRight, Wifi, WifiOff, Zap, Plus, Minus, Timer, X,
} from "lucide-react";

import styles from "@/components/dashboard/dashboard.module.css";
import { ScopedErrorBoundary } from "@/components/system/scoped-error-boundary";
import { formatRelativeTime } from "@/lib/utils";
import { useWs } from "@/lib/ws-context";
import type {
  ChannelView, ControllerSnapshot, HistoryPoint,
  PestControlSchedule, PestLogEntry, ScheduledCommandView,
} from "@/lib/types";

type Props = { initialSnapshot: ControllerSnapshot };
type Range = "24h" | "7d" | "30d";
const MANUAL_OVERRIDE_MINUTES = 2;

const DEFAULT_ACTUATOR_LINKS: Record<string, string[]> = {
  tank_level: ["pump"],
  soil_moisture: ["irrigation_valve"],
  turbidity: ["flush_valve", "inlet_valve"],
  fish_tank_level: ["inlet_valve"],
};

type ChannelCardGroup = { primary: ChannelView; controls: ChannelView[] };

function statusClass(s: string) {
  if (s === "online") return styles.online;
  if (s === "stale") return styles.stale;
  return styles.offline;
}

function alertClass(s: string) {
  if (s === "critical") return styles.alertCritical;
  if (s === "warning") return styles.alertWarning;
  return styles.alertInfo;
}

function readLinkedActuatorKeys(channel: ChannelView) {
  const v = channel.config.linkedActuatorChannelKeys;
  if (!Array.isArray(v)) return [];
  return v.filter((i): i is string => typeof i === "string" && i.length > 0);
}

function getCardGroups(channels: ChannelView[]) {
  const byKey = new Map(channels.map((c) => [c.channelKey, c]));
  const actuators = channels.filter((c) => c.kind !== "sensor" && c.template !== "camera_snapshot");
  const used = new Set<string>();
  const primaries = channels.filter((c) => c.kind !== "actuator" && c.template !== "camera_snapshot");

  const groups: ChannelCardGroup[] = primaries.map((primary) => {
    const explicit = readLinkedActuatorKeys(primary);
    const controls: ChannelView[] = [];
    if (primary.kind !== "sensor") { controls.push(primary); used.add(primary.id); }
    if (explicit.length) {
      for (const key of explicit) {
        const linked = byKey.get(key);
        if (!linked || linked.kind === "sensor" || used.has(linked.id) || linked.id === primary.id) continue;
        controls.push(linked); used.add(linked.id);
      }
    } else {
      for (const tid of DEFAULT_ACTUATOR_LINKS[primary.template] ?? []) {
        const linked = actuators.find((c) => c.template === tid && !used.has(c.id) && c.id !== primary.id);
        if (!linked) continue;
        controls.push(linked); used.add(linked.id);
      }
    }
    return { primary, controls };
  });

  return { groups, standaloneActuators: actuators.filter((c) => !used.has(c.id)) };
}

function fmtVal(c: ChannelView) {
  if (c.kind === "actuator") return c.latestBooleanState ? "On" : "Off";
  return `${c.latestNumericValue ?? "--"} ${c.unit}`;
}

function progress(c: ChannelView) {
  if (c.kind === "actuator" || c.latestNumericValue === null) return c.latestBooleanState ? 100 : 0;
  return ((c.latestNumericValue - c.minValue) / Math.max(c.maxValue - c.minValue, 1)) * 100;
}

function labels(c: ChannelView) {
  return {
    on: typeof c.config.onLabel === "string" ? c.config.onLabel : "On",
    off: typeof c.config.offLabel === "string" ? c.config.offLabel : "Off",
  };
}

function TemplateIcon({ template }: { template: string }) {
  const map: Record<string, React.ReactNode> = {
    tank_level: <Droplets size={15} />,
    soil_moisture: <Sprout size={15} />,
    turbidity: <FlaskConical size={15} />,
    fish_tank_level: <Fish size={15} />,
    pump: <Activity size={15} />,
    irrigation_valve: <Leaf size={15} />,
    flush_valve: <Droplets size={15} />,
    inlet_valve: <Droplets size={15} />,
    battery_voltage: <Zap size={15} />,
    spray_pump: <Bug size={15} />,
    uv_zapper: <Sun size={15} />,
    camera_snapshot: <Camera size={15} />,
  };
  return <span style={{ color: "var(--primary)", display: "flex" }}>{map[template] ?? <Activity size={15} />}</span>;
}

export function ControllerDetail({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [range, setRange] = useState<Range>("24h");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { lastMessage, connected } = useWs();

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "controller_update" && lastMessage.data.id === snapshot.controller.id) {
      setSnapshot((prev) => ({ ...prev, controller: lastMessage.data }));
    }
  }, [lastMessage, snapshot.controller.id]);

  useEffect(() => {
    if (connected) return;
    const iv = window.setInterval(async () => {
      const r = await fetch(`/api/controllers/${snapshot.controller.id}`, { cache: "no-store" });
      if (r.ok) setSnapshot((await r.json()) as ControllerSnapshot);
    }, 3_000);
    return () => window.clearInterval(iv);
  }, [connected, snapshot.controller.id]);

  const numericChannels = useMemo(
    () => snapshot.controller.channels.filter((c) => c.kind !== "actuator"),
    [snapshot.controller.channels]
  );
  const { groups, standaloneActuators } = useMemo(
    () => getCardGroups(snapshot.controller.channels),
    [snapshot.controller.channels]
  );
  const cameraChannels = useMemo(
    () => snapshot.controller.channels.filter((c) => c.template === "camera_snapshot"),
    [snapshot.controller.channels]
  );
  const hasPestControl = useMemo(
    () => snapshot.controller.channels.some((c) => c.template === "spray_pump" || c.template === "uv_zapper"),
    [snapshot.controller.channels]
  );

  useEffect(() => {
    if (!selectedChannelId && numericChannels.length) setSelectedChannelId(numericChannels[0].id);
  }, [numericChannels, selectedChannelId]);

  useEffect(() => {
    if (!selectedChannelId) { setHistory([]); return; }
    let active = true;
    async function load() {
      const r = await fetch(`/api/channels/${selectedChannelId}/history?range=${range}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { points: HistoryPoint[] };
      if (active) setHistory(d.points);
    }
    load();
    const iv = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(iv); };
  }, [selectedChannelId, range]);

  const controlsDisabled = snapshot.controller.status === "offline";

  async function refreshSnapshot() {
    const r = await fetch(`/api/controllers/${snapshot.controller.id}`, { cache: "no-store" });
    if (r.ok) setSnapshot((await r.json()) as ControllerSnapshot);
  }

  async function sendCommand(channel: ChannelView, desiredBooleanState: boolean) {
    setBusyChannelId(channel.id);
    setMessage("");
    const r = await fetch(`/api/channels/${channel.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desiredBooleanState, overrideMinutes: MANUAL_OVERRIDE_MINUTES }),
    });
    const d = await r.json();
    if (!r.ok) { setMessage(d.error ?? "Command failed."); setBusyChannelId(null); return; }
    setMessage(`${channel.name} set to ${desiredBooleanState ? "On" : "Off"}. Override expires in ${MANUAL_OVERRIDE_MINUTES} min.`);
    setBusyChannelId(null);
    await refreshSnapshot();
  }

  return (
    <>
      {/* Header */}
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Controller operations</p>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>{snapshot.controller.name}</h1>
          <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <Cpu size={12} /> {snapshot.controller.hardwareId}
            <span style={{ opacity: 0.3 }}>·</span>
            {snapshot.controller.location}
            <span style={{ opacity: 0.3 }}>·</span>
            <Clock size={12} /> {formatRelativeTime(snapshot.controller.lastSeenAt)}
          </p>
        </div>
        <div className={styles.actions}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem", color: connected ? "var(--success)" : "var(--muted)" }}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? "Live" : "Polling"}
          </span>
          <span className={`${styles.status} ${statusClass(snapshot.controller.status)}`}>{snapshot.controller.status}</span>
          <a className={styles.ghostButton} href="/dashboard/settings" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Settings size={14} /> Manage
          </a>
        </div>
      </header>

      {message && <p className={styles.muted} style={{ padding: "0 0.2rem", fontSize: "0.85rem" }}>{message}</p>}

      {/* Sensor + actuator cards */}
      <ScopedErrorBoundary
        badge="Controller channels"
        title="Channel cards are unavailable"
        message="This controller page is still active, but the live channel section failed to render."
      >
        <section className={styles.sensorGrid}>
        {groups.map(({ primary, controls }) => (
          <article key={primary.id} className={styles.sensorCard}>
            <div className={styles.rowBetween}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <TemplateIcon template={primary.template} />
                <div>
                  <p className={styles.eyebrow} style={{ margin: 0 }}>{primary.template.replaceAll("_", " ")}</p>
                  <strong style={{ fontSize: "0.9rem" }}>{primary.name}</strong>
                </div>
              </div>
              <span className={`${styles.status} ${primary.latestStatus === "critical" ? styles.offline : styles.online}`}>{primary.kind}</span>
            </div>
            <div className={styles.reading}>{fmtVal(primary)}</div>
            <div className={styles.progress}><span style={{ width: `${Math.max(0, Math.min(progress(primary), 100))}%` }} /></div>
            <p className={styles.small}>{primary.channelKey} · {formatRelativeTime(primary.lastSampleAt)}</p>
            {controls.length > 0 && (
              <div className={styles.linkedControlList}>
                {controls.map((ctrl) => {
                  const lb = labels(ctrl);
                  const isOn = ctrl.latestBooleanState === true;
                  return (
                    <div key={ctrl.id} className={styles.linkedControlCard}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ color: isOn ? "var(--primary)" : "var(--muted)", display: "flex" }}>
                          {isOn ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </span>
                        <div>
                          <strong style={{ fontSize: "0.85rem" }}>{ctrl.name}</strong>
                          <p className={styles.small} style={{ margin: 0 }}>{ctrl.latestBooleanState ? lb.on : lb.off} · {ctrl.channelKey}</p>
                        </div>
                      </div>
                      <button
                        className={`${isOn ? styles.button : styles.ghostButton} ${styles.controlToggleButton}`}
                        type="button"
                        onClick={() => void sendCommand(ctrl, !isOn)}
                        disabled={controlsDisabled || busyChannelId === ctrl.id}
                      >
                        {isOn ? lb.on : lb.off}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        ))}

        {standaloneActuators.map((channel) => {
          const lb = labels(channel);
          const isOn = channel.latestBooleanState === true;
          return (
            <article key={channel.id} className={styles.sensorCard}>
              <div className={styles.rowBetween}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <TemplateIcon template={channel.template} />
                  <div>
                    <p className={styles.eyebrow} style={{ margin: 0 }}>{channel.template.replaceAll("_", " ")}</p>
                    <strong style={{ fontSize: "0.9rem" }}>{channel.name}</strong>
                  </div>
                </div>
                <span className={`${styles.status} ${styles.online}`}>{channel.kind}</span>
              </div>
              <div className={styles.reading}>{fmtVal(channel)}</div>
              <div className={styles.progress}><span style={{ width: `${Math.max(0, Math.min(progress(channel), 100))}%` }} /></div>
              <p className={styles.small}>{channel.channelKey} · {formatRelativeTime(channel.lastSampleAt)}</p>
              <div className={styles.linkedControlList}>
                <div className={styles.linkedControlCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ color: isOn ? "var(--primary)" : "var(--muted)", display: "flex" }}>
                      {isOn ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </span>
                    <strong style={{ fontSize: "0.85rem" }}>{channel.name}</strong>
                  </div>
                  <button
                    className={`${isOn ? styles.button : styles.ghostButton} ${styles.controlToggleButton}`}
                    type="button"
                    onClick={() => void sendCommand(channel, !isOn)}
                    disabled={controlsDisabled || busyChannelId === channel.id}
                  >
                    {isOn ? lb.on : lb.off}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        </section>
      </ScopedErrorBoundary>

      {/* Camera snapshot cards */}
      {cameraChannels.length ? (
        <ScopedErrorBoundary
          badge="Camera feed"
          title="Snapshot cards are unavailable"
          message="The camera resource failed to render, but the rest of the controller page is still available."
        >
          <>
            {cameraChannels.map((ch) => {
              const snap = snapshot.latestSnapshots?.[ch.id];
              const imgSrc = snap?.imageUrl ?? snap?.imageBase64 ?? null;
              return (
                <article key={ch.id} className={`${styles.panel} ${styles.snapshotPanel}`}>
                  <div className={styles.sectionHead}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Camera size={16} style={{ color: "var(--muted)" }} />
                      <div>
                        <p className={styles.eyebrow}>Camera snapshot</p>
                        <h2 style={{ margin: 0, fontSize: "1rem" }}>{ch.name}</h2>
                      </div>
                    </div>
                  </div>
                  {imgSrc
                    ? <img src={imgSrc} alt={ch.name} className={styles.snapshotImage} />
                    : <div className={styles.empty}>No snapshot yet.</div>}
                  <p className={styles.small} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <Clock size={11} /> Updated {formatRelativeTime(ch.lastSampleAt)}
                  </p>
                </article>
              );
            })}
          </>
        </ScopedErrorBoundary>
      ) : null}

      {/* History + Alerts + Commands */}
      <section className={styles.metricGrid}>
        <ScopedErrorBoundary
          badge="History chart"
          title="Sensor trends are unavailable"
          message="The trend chart failed in this panel only. The rest of the controller page is still running."
        >
          <article className={`${styles.panel} ${styles.chartPanel}`}>
            <div className={styles.sectionHead}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <History size={16} style={{ color: "var(--muted)" }} />
                <div>
                  <p className={styles.eyebrow}>History</p>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Sensor trends</h2>
                </div>
              </div>
              <div className={styles.actions}>
                <select value={selectedChannelId ?? ""} onChange={(e) => setSelectedChannelId(e.target.value)}>
                  {numericChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                </select>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <XAxis dataKey="recordedAt" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={36} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "8px", color: "var(--text)" }} />
                  <Line type="monotone" dataKey="numericValue" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
        </ScopedErrorBoundary>

        <div className={styles.section}>
          <ScopedErrorBoundary
            badge="Controller alerts"
            title="Active issues are unavailable"
            message="Only the alerts panel failed here. Other controller resources are still available."
          >
            <article className={styles.panel}>
              <div className={styles.sectionHead}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Bell size={15} style={{ color: "var(--muted)" }} />
                  <div>
                    <p className={styles.eyebrow}>Alerts</p>
                    <h2 style={{ margin: 0, fontSize: "1rem" }}>Active issues</h2>
                  </div>
                </div>
              </div>
              <div className={styles.alertList}>
                {snapshot.alerts.length ? snapshot.alerts.map((alert) => (
                  <article key={alert.id} className={`${styles.alertCard} ${alertClass(alert.severity)}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <AlertTriangle size={13} />
                      <strong style={{ fontSize: "0.88rem" }}>{alert.title}</strong>
                    </div>
                    <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>{alert.message}</p>
                    <p className={styles.small} style={{ margin: "0.2rem 0 0" }}>{formatRelativeTime(alert.openedAt)}</p>
                  </article>
                )) : <div className={styles.empty}>No open alerts for this controller.</div>}
              </div>
            </article>
          </ScopedErrorBoundary>

          <ScopedErrorBoundary
            badge="Command log"
            title="Recent commands are unavailable"
            message="The command log failed in-place, but the rest of the controller page is still available."
          >
            <article className={styles.panel}>
              <div className={styles.sectionHead}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ChevronRight size={15} style={{ color: "var(--muted)" }} />
                  <div>
                    <p className={styles.eyebrow}>Commands</p>
                    <h2 style={{ margin: 0, fontSize: "1rem" }}>Recent log</h2>
                  </div>
                </div>
              </div>
              <div className={styles.commandList}>
                {snapshot.commands.length ? snapshot.commands.map((cmd) => (
                  <div key={cmd.id} className={styles.card}>
                    <strong style={{ fontSize: "0.88rem" }}>{cmd.commandType}</strong>
                    <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
                      {cmd.desiredBooleanState !== null ? `State: ${cmd.desiredBooleanState ? "On" : "Off"}` : `Value: ${cmd.desiredNumericValue}`}
                    </p>
                    <p className={styles.small} style={{ margin: "0.2rem 0 0" }}>{cmd.status} · {formatRelativeTime(cmd.createdAt)}</p>
                  </div>
                )) : <div className={styles.empty}>No commands issued yet.</div>}
              </div>
            </article>
          </ScopedErrorBoundary>
        </div>
      </section>

      {/* Scheduled Commands */}
      <ScopedErrorBoundary
        badge="Scheduled commands"
        title="Scheduled commands are unavailable"
        message="The scheduled commands panel failed, but the rest of the controller page is still available."
      >
        <ScheduledCommandsPanel 
          controllerId={snapshot.controller.id} 
          channels={snapshot.controller.channels}
          scheduledCommands={snapshot.scheduledCommands}
          onRefresh={refreshSnapshot}
        />
      </ScopedErrorBoundary>

      {/* Pest Control */}
      {hasPestControl && (
        <section className={styles.metricGrid}>
          <ScopedErrorBoundary
            badge="Pest schedule"
            title="Pest schedule is unavailable"
            message="The schedule panel failed in-place, but the rest of the controller page is still available."
          >
            <PestSchedulePanel controllerId={snapshot.controller.id} />
          </ScopedErrorBoundary>
          <ScopedErrorBoundary
            badge="Pest activity"
            title="Pest activity log is unavailable"
            message="The activity panel failed in-place, but other controller resources are still available."
          >
            <PestLogPanel pestLog={snapshot.pestLog ?? []} />
          </ScopedErrorBoundary>
        </section>
      )}
    </>
  );
}

// ─── Pest Schedule Panel ──────────────────────────────────────────────────────

function PestSchedulePanel({ controllerId }: { controllerId: string }) {
  const [enabled, setEnabled] = useState(true);
  const [sprayEntries, setSprayEntries] = useState<Array<{ startTime: string; durationMinutes: number }>>([]);
  const [uvStartTime, setUvStartTime] = useState("");
  const [uvEndTime, setUvEndTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/controllers/${controllerId}/pest-schedule`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { schedule: PestControlSchedule | null }) => {
        if (d.schedule) {
          setEnabled(d.schedule.enabled);
          setSprayEntries(d.schedule.sprayEntries);
          setUvStartTime(d.schedule.uvStartTime ?? "");
          setUvEndTime(d.schedule.uvEndTime ?? "");
        }
      })
      .catch(() => {});
  }, [controllerId]);

  async function save() {
    setSaving(true); setMsg("");
    const r = await fetch(`/api/controllers/${controllerId}/pest-schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, sprayEntries, uvStartTime: uvStartTime || null, uvEndTime: uvEndTime || null }),
    });
    const d = await r.json();
    setSaving(false);
    setMsg(r.ok ? "Schedule saved." : (d.error ?? "Could not save schedule."));
  }

  return (
    <article className={styles.panel} style={{ padding: "1.2rem" }}>
      <div className={styles.sectionHead}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Calendar size={16} style={{ color: "var(--muted)" }} />
          <div>
            <p className={styles.eyebrow}>Pest Control</p>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Spray schedule</h2>
          </div>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span style={{ fontSize: "0.88rem", color: "var(--text-soft)" }}>Enabled</span>
        </label>

        <div>
          <p className={styles.eyebrow} style={{ marginBottom: "0.5rem" }}>Spray time slots</p>
          <div className={styles.formGrid}>
            {sprayEntries.map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="time" value={entry.startTime} onChange={(e) => setSprayEntries((p) => p.map((s, j) => j === i ? { ...s, startTime: e.target.value } : s))} style={{ flex: 1 }} />
                <input type="number" min={1} max={120} value={entry.durationMinutes} style={{ width: "70px" }} onChange={(e) => setSprayEntries((p) => p.map((s, j) => j === i ? { ...s, durationMinutes: Number(e.target.value) } : s))} />
                <span className={styles.small}>min</span>
                <button className={styles.dangerButton} type="button" style={{ padding: "0.4rem 0.6rem" }} onClick={() => setSprayEntries((p) => p.filter((_, j) => j !== i))}>
                  <Minus size={13} />
                </button>
              </div>
            ))}
            {sprayEntries.length < 10 && (
              <button className={styles.ghostButton} type="button" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }} onClick={() => setSprayEntries((p) => [...p, { startTime: "06:00", durationMinutes: 15 }])}>
                <Plus size={14} /> Add Slot
              </button>
            )}
          </div>
        </div>

        <div>
          <p className={styles.eyebrow} style={{ marginBottom: "0.5rem" }}>UV Zapper window</p>
          <div className={styles.twoCol}>
            <label className={styles.formRow}>
              <span>On at (dusk)</span>
              <input type="time" value={uvStartTime} onChange={(e) => setUvStartTime(e.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>Off at (dawn)</span>
              <input type="time" value={uvEndTime} onChange={(e) => setUvEndTime(e.target.value)} />
            </label>
          </div>
        </div>

        {msg && <p className={styles.muted} style={{ fontSize: "0.85rem" }}>{msg}</p>}
        <button className={styles.button} type="button" onClick={() => void save()} disabled={saving} style={{ display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "center" }}>
          {saving ? "Saving…" : "Save Schedule"}
        </button>
      </div>
    </article>
  );
}

// ─── Pest Log Panel ───────────────────────────────────────────────────────────

function PestLogPanel({ pestLog }: { pestLog: PestLogEntry[] }) {
  return (
    <article className={styles.panel} style={{ padding: "1.2rem" }}>
      <div className={styles.sectionHead}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Activity size={16} style={{ color: "var(--muted)" }} />
          <div>
            <p className={styles.eyebrow}>Pest Control</p>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Activity log</h2>
          </div>
        </div>
      </div>
      <div className={styles.alertList}>
        {pestLog.length ? pestLog.map((entry, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.rowBetween}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                {entry.channelName.toLowerCase().includes("spray") ? <Bug size={13} style={{ color: "var(--primary)" }} /> : <Sun size={13} style={{ color: "var(--warning)" }} />}
                <strong style={{ fontSize: "0.88rem" }}>{entry.channelName}</strong>
              </div>
              <span className={styles.tag}>{entry.activationType}</span>
            </div>
            <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>{entry.booleanState ? "On" : "Off"}</p>
            <p className={styles.small} style={{ margin: "0.2rem 0 0", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <Clock size={11} /> {formatRelativeTime(entry.recordedAt)}
            </p>
          </div>
        )) : <div className={styles.empty}>No activity yet.</div>}
      </div>
    </article>
  );
}

// ─── Scheduled Commands Panel ─────────────────────────────────────────────────

type ScheduledCommandsPanelProps = {
  controllerId: string;
  channels: ChannelView[];
  scheduledCommands: ScheduledCommandView[];
  onRefresh: () => Promise<void>;
};

function ScheduledCommandsPanel({ controllerId, channels, scheduledCommands, onRefresh }: ScheduledCommandsPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [desiredState, setDesiredState] = useState<"on" | "off">("on");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const actuatorChannels = channels.filter((c) => c.kind === "actuator" || c.kind === "hybrid");
  const pendingCommands = scheduledCommands.filter((c) => c.status === "pending");

  async function scheduleCommand() {
    if (!selectedChannelId || !scheduledDate || !scheduledTime) {
      setMsg("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    setMsg("");

    try {
      const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
      
      const r = await fetch(`/api/channels/${selectedChannelId}/scheduled-commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          desiredBooleanState: desiredState === "on",
          note: note.trim(),
          scheduledFor: scheduledFor.toISOString(),
        }),
      });

      const d = await r.json();
      
      if (!r.ok) {
        setMsg(d.error ?? "Failed to schedule command.");
        setSaving(false);
        return;
      }

      setMsg("Command scheduled successfully!");
      setShowForm(false);
      setNote("");
      await onRefresh();
    } catch (error) {
      setMsg("An error occurred while scheduling the command.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelCommand(commandId: string) {
    try {
      const r = await fetch(`/api/scheduled-commands/${commandId}`, {
        method: "DELETE",
      });

      if (r.ok) {
        await onRefresh();
      }
    } catch (error) {
      console.error("Failed to cancel command:", error);
    }
  }

  // Set default date/time to 10 minutes from now
  useEffect(() => {
    if (showForm && !scheduledDate) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 10);
      setScheduledDate(now.toISOString().split("T")[0]);
      setScheduledTime(now.toTimeString().slice(0, 5));
    }
  }, [showForm, scheduledDate]);

  // Set default channel
  useEffect(() => {
    if (actuatorChannels.length && !selectedChannelId) {
      setSelectedChannelId(actuatorChannels[0].id);
    }
  }, [actuatorChannels, selectedChannelId]);

  return (
    <article className={styles.panel} style={{ padding: "1.2rem" }}>
      <div className={styles.sectionHead}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Timer size={16} style={{ color: "var(--muted)" }} />
          <div>
            <p className={styles.eyebrow}>Automation</p>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Scheduled commands</h2>
          </div>
        </div>
        <button
          className={styles.button}
          type="button"
          onClick={() => setShowForm(!showForm)}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.8rem" }}
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "Cancel" : "Schedule"}
        </button>
      </div>

      {showForm && (
        <div className={styles.formGrid} style={{ marginTop: "1rem", padding: "1rem", background: "var(--surface)", borderRadius: "8px" }}>
          <label className={styles.formRow}>
            <span>Channel</span>
            <select value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)}>
              {actuatorChannels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.formRow}>
            <span>Action</span>
            <select value={desiredState} onChange={(e) => setDesiredState(e.target.value as "on" | "off")}>
              <option value="on">Turn On</option>
              <option value="off">Turn Off</option>
            </select>
          </label>

          <div className={styles.twoCol}>
            <label className={styles.formRow}>
              <span>Date</span>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </label>

            <label className={styles.formRow}>
              <span>Time</span>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </label>
          </div>

          <label className={styles.formRow}>
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Spray pesticide for 15 minutes"
            />
          </label>

          {msg && <p className={styles.muted} style={{ fontSize: "0.85rem" }}>{msg}</p>}

          <button
            className={styles.button}
            type="button"
            onClick={() => void scheduleCommand()}
            disabled={saving}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "center" }}
          >
            {saving ? "Scheduling…" : "Schedule Command"}
          </button>
        </div>
      )}

      <div className={styles.alertList} style={{ marginTop: "1rem" }}>
        {pendingCommands.length ? pendingCommands.map((cmd) => (
          <div key={cmd.id} className={styles.card}>
            <div className={styles.rowBetween}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Timer size={13} style={{ color: "var(--primary)" }} />
                  <strong style={{ fontSize: "0.88rem" }}>{cmd.channelName}</strong>
                </div>
                <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
                  {cmd.desiredBooleanState ? "Turn On" : "Turn Off"}
                  {cmd.note && ` · ${cmd.note}`}
                </p>
                <p className={styles.small} style={{ margin: "0.2rem 0 0", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Clock size={11} /> Scheduled for {new Date(cmd.scheduledFor).toLocaleString()}
                </p>
              </div>
              <button
                className={styles.dangerButton}
                type="button"
                onClick={() => void cancelCommand(cmd.id)}
                style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )) : <div className={styles.empty}>No scheduled commands. Click "Schedule" to create one.</div>}
      </div>

      {scheduledCommands.filter((c) => c.status !== "pending").length > 0 && (
        <>
          <h3 style={{ margin: "1.5rem 0 0.5rem", fontSize: "0.9rem", color: "var(--muted)" }}>History</h3>
          <div className={styles.alertList}>
            {scheduledCommands.filter((c) => c.status !== "pending").slice(0, 5).map((cmd) => (
              <div key={cmd.id} className={styles.card} style={{ opacity: 0.7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.88rem" }}>{cmd.channelName}</strong>
                  <span className={styles.tag}>{cmd.status}</span>
                </div>
                <p className={styles.muted} style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
                  {cmd.desiredBooleanState ? "Turn On" : "Turn Off"}
                  {cmd.note && ` · ${cmd.note}`}
                </p>
                <p className={styles.small} style={{ margin: "0.2rem 0 0" }}>
                  {cmd.status === "executed" && `Executed ${formatRelativeTime(cmd.executedAt)}`}
                  {cmd.status === "cancelled" && `Cancelled ${formatRelativeTime(cmd.cancelledAt)}`}
                  {cmd.status === "failed" && `Failed: ${cmd.failureReason}`}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
