"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import styles from "@/components/dashboard/dashboard.module.css";
import { formatRelativeTime } from "@/lib/utils";
import type { ChannelView, ControllerSnapshot, HistoryPoint } from "@/lib/types";

type Props = {
  initialSnapshot: ControllerSnapshot;
};

type Range = "24h" | "7d" | "30d";

const DEFAULT_ACTUATOR_LINKS: Record<string, string[]> = {
  tank_level: ["pump"],
  soil_moisture: ["irrigation_valve"],
  turbidity: ["flush_valve", "inlet_valve"],
  fish_tank_level: ["inlet_valve"],
};

type ChannelCardGroup = {
  primary: ChannelView;
  controls: ChannelView[];
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

function readLinkedActuatorKeys(channel: ChannelView) {
  const value = channel.config.linkedActuatorChannelKeys;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function getCardGroups(channels: ChannelView[]) {
  const channelsByKey = new Map(channels.map((channel) => [channel.channelKey, channel]));
  const actuators = channels.filter((channel) => channel.kind !== "sensor");
  const usedActuatorIds = new Set<string>();
  const primaryChannels = channels.filter((channel) => channel.kind !== "actuator");

  const groups: ChannelCardGroup[] = primaryChannels.map((primary) => {
    const explicitKeys = readLinkedActuatorKeys(primary);
    const controls: ChannelView[] = [];

    if (primary.kind !== "sensor") {
      controls.push(primary);
      usedActuatorIds.add(primary.id);
    }

    if (explicitKeys.length) {
      for (const key of explicitKeys) {
        const linked = channelsByKey.get(key);
        if (!linked || linked.kind === "sensor" || usedActuatorIds.has(linked.id) || linked.id === primary.id) {
          continue;
        }
        controls.push(linked);
        usedActuatorIds.add(linked.id);
      }
    } else {
      const templateLinks = DEFAULT_ACTUATOR_LINKS[primary.template] ?? [];
      for (const templateId of templateLinks) {
        const linked = actuators.find((candidate) => candidate.template === templateId && !usedActuatorIds.has(candidate.id) && candidate.id !== primary.id);
        if (!linked) {
          continue;
        }
        controls.push(linked);
        usedActuatorIds.add(linked.id);
      }
    }

    return { primary, controls };
  });

  const standaloneActuators = actuators.filter((channel) => !usedActuatorIds.has(channel.id));
  return { groups, standaloneActuators };
}

function formatChannelValue(channel: ChannelView) {
  if (channel.kind === "actuator") {
    return channel.latestBooleanState ? "On" : "Off";
  }
  return `${channel.latestNumericValue ?? "--"} ${channel.unit}`;
}

function getProgress(channel: ChannelView) {
  if (channel.kind === "actuator" || channel.latestNumericValue === null) {
    return channel.latestBooleanState ? 100 : 0;
  }
  return ((channel.latestNumericValue - channel.minValue) / Math.max(channel.maxValue - channel.minValue, 1)) * 100;
}

function getControlLabels(channel: ChannelView) {
  const rawOn = typeof channel.config.onLabel === "string" ? channel.config.onLabel : undefined;
  const rawOff = typeof channel.config.offLabel === "string" ? channel.config.offLabel : undefined;
  return {
    on: rawOn ?? "On",
    off: rawOff ?? "Off",
  };
}

export function ControllerDetail({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [range, setRange] = useState<Range>("24h");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [commandNote, setCommandNote] = useState("");
  const [overrideMinutes, setOverrideMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const numericChannels = useMemo(
    () => snapshot.controller.channels.filter((channel) => channel.kind !== "actuator"),
    [snapshot.controller.channels]
  );
  const { groups, standaloneActuators } = useMemo(() => getCardGroups(snapshot.controller.channels), [snapshot.controller.channels]);

  useEffect(() => {
    if (!selectedChannelId && numericChannels.length) {
      setSelectedChannelId(numericChannels[0].id);
    }
  }, [numericChannels, selectedChannelId]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/controllers/${snapshot.controller.id}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as ControllerSnapshot;
      setSnapshot(data);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [snapshot.controller.id]);

  useEffect(() => {
    if (!selectedChannelId) {
      setHistory([]);
      return;
    }

    let active = true;

    async function loadHistory() {
      const response = await fetch(`/api/channels/${selectedChannelId}/history?range=${range}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { points: HistoryPoint[] };
      if (active) {
        setHistory(data.points);
      }
    }

    loadHistory();
    const interval = window.setInterval(loadHistory, 30_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedChannelId, range]);

  const modalChannel = snapshot.controller.channels.find((channel) => channel.id === modalChannelId) ?? null;
  const controlsDisabled = snapshot.controller.status === "offline";

  async function sendCommand(desiredBooleanState: boolean) {
    if (!modalChannel) {
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/channels/${modalChannel.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        desiredBooleanState,
        note: commandNote,
        overrideMinutes,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Command failed.");
      setBusy(false);
      return;
    }
    setMessage("Command queued successfully.");
    setCommandNote("");
    setOverrideMinutes(30);
    setModalChannelId(null);
    setBusy(false);
    const refresh = await fetch(`/api/controllers/${snapshot.controller.id}`, { cache: "no-store" });
    if (refresh.ok) {
      setSnapshot((await refresh.json()) as ControllerSnapshot);
    }
  }

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Controller operations</p>
          <h1>{snapshot.controller.name}</h1>
          <p className={styles.muted}>
            {snapshot.controller.hardwareId} / {snapshot.controller.location} / Last seen {formatRelativeTime(snapshot.controller.lastSeenAt)}
          </p>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.status} ${statusClass(snapshot.controller.status)}`}>{snapshot.controller.status}</span>
          <a className={styles.ghostButton} href="/dashboard/settings">
            Manage in Settings
          </a>
        </div>
      </header>

      <section className={styles.sensorGrid}>
        {groups.map(({ primary, controls }) => {
          const value = formatChannelValue(primary);
          const progress = getProgress(primary);

          return (
            <article key={primary.id} className={styles.sensorCard}>
              <div className={styles.rowBetween}>
                <div>
                  <p className={styles.eyebrow}>{primary.template.replaceAll("_", " ")}</p>
                  <strong>{primary.name}</strong>
                </div>
                <span className={`${styles.status} ${primary.latestStatus === "critical" ? styles.offline : styles.online}`}>{primary.kind}</span>
              </div>
              <div className={styles.reading}>{value}</div>
              <div className={styles.progress}>
                <span style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} />
              </div>
              <p className={styles.small}>
                Channel key: {primary.channelKey} / Updated {formatRelativeTime(primary.lastSampleAt)}
              </p>
              {controls.length ? (
                <div className={styles.linkedControlList}>
                  {controls.map((control) => {
                    const labels = getControlLabels(control);

                    return (
                      <div key={control.id} className={styles.linkedControlCard}>
                        <div>
                          <strong>{control.name}</strong>
                          <p className={styles.small}>
                            {control.latestBooleanState ? labels.on : labels.off} / {control.channelKey}
                          </p>
                        </div>
                        <button className={styles.ghostButton} type="button" onClick={() => setModalChannelId(control.id)} disabled={controlsDisabled}>
                          {labels.on} / {labels.off}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
        {standaloneActuators.map((channel) => {
          const labels = getControlLabels(channel);

          return (
            <article key={channel.id} className={styles.sensorCard}>
              <div className={styles.rowBetween}>
                <div>
                  <p className={styles.eyebrow}>{channel.template.replaceAll("_", " ")}</p>
                  <strong>{channel.name}</strong>
                </div>
                <span className={`${styles.status} ${styles.online}`}>{channel.kind}</span>
              </div>
              <div className={styles.reading}>{formatChannelValue(channel)}</div>
              <div className={styles.progress}>
                <span style={{ width: `${Math.max(0, Math.min(getProgress(channel), 100))}%` }} />
              </div>
              <p className={styles.small}>
                Channel key: {channel.channelKey} / Updated {formatRelativeTime(channel.lastSampleAt)}
              </p>
              <div className={styles.linkedControlList}>
                <div className={styles.linkedControlCard}>
                  <div>
                    <strong>{channel.name}</strong>
                    <p className={styles.small}>{channel.latestBooleanState ? labels.on : labels.off}</p>
                  </div>
                  <button className={styles.ghostButton} type="button" onClick={() => setModalChannelId(channel.id)} disabled={controlsDisabled}>
                    {labels.on} / {labels.off}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className={styles.metricGrid}>
        <article className={`${styles.panel} ${styles.chartPanel}`}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>History</p>
              <h2>Sensor trends</h2>
            </div>
            <div className={styles.actions}>
              <select value={selectedChannelId ?? ""} onChange={(event) => setSelectedChannelId(event.target.value)}>
                {numericChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
              <select value={range} onChange={(event) => setRange(event.target.value as Range)}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </div>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <XAxis dataKey="recordedAt" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip />
                <Line type="monotone" dataKey="numericValue" stroke="#1f5a40" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <div className={styles.section}>
          <article className={styles.panel}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>Alerts</p>
                <h2>Active issues</h2>
              </div>
            </div>
            <div className={styles.alertList}>
              {snapshot.alerts.length ? (
                snapshot.alerts.map((alert) => (
                  <article key={alert.id} className={`${styles.alertCard} ${alertClass(alert.severity)}`}>
                    <strong>{alert.title}</strong>
                    <p className={styles.muted}>{alert.message}</p>
                    <p className={styles.small}>{formatRelativeTime(alert.openedAt)}</p>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>No open alerts for this controller.</div>
              )}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>Commands</p>
                <h2>Recent command log</h2>
              </div>
            </div>
            <div className={styles.commandList}>
              {snapshot.commands.length ? (
                snapshot.commands.map((command) => (
                  <div key={command.id} className={styles.card}>
                    <strong>{command.commandType}</strong>
                    <p className={styles.muted}>
                      {command.desiredBooleanState !== null ? `State: ${command.desiredBooleanState ? "On" : "Off"}` : `Value: ${command.desiredNumericValue}`}
                    </p>
                    <p className={styles.small}>
                      {command.status} / {formatRelativeTime(command.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <div className={styles.empty}>No commands issued yet.</div>
              )}
            </div>
          </article>
        </div>
      </section>

      {modalChannel ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <p className={styles.eyebrow}>Manual override</p>
            <h3>{modalChannel.name}</h3>
            <div className={styles.formGrid}>
              <label className={styles.formRow}>
                <span>Operator note</span>
                <textarea value={commandNote} onChange={(event) => setCommandNote(event.target.value)} rows={3} placeholder="Reason for override" />
              </label>
              <label className={styles.formRow}>
                <span>Override window (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={overrideMinutes}
                  onChange={(event) => setOverrideMinutes(Number(event.target.value) || 30)}
                />
              </label>
              <p className={styles.muted}>This command will be delivered to the controller on its next `/api/device/sync` request.</p>
              <div className={styles.actions}>
                <button className={styles.ghostButton} type="button" onClick={() => setModalChannelId(null)}>
                  Cancel
                </button>
                <button className={styles.ghostButton} type="button" onClick={() => void sendCommand(false)} disabled={busy}>
                  Queue Off / Close
                </button>
                <button className={styles.button} type="button" onClick={() => void sendCommand(true)} disabled={busy}>
                  Queue On / Open
                </button>
              </div>
              {message ? <p className={styles.muted}>{message}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
