"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/components/dashboard/dashboard.module.css";
import { CHANNEL_TEMPLATES, CONTROLLER_SETUP_PRESETS, getSetupPreset, getTemplate, type SetupPreset } from "@/lib/templates";
import type { ControllerCard, DashboardSnapshot } from "@/lib/types";

type Props = {
  initialSnapshot: DashboardSnapshot;
};

type ChannelFormState = {
  controllerId: string;
  channelKey: string;
  name: string;
  template: string;
};

type RevealedKeyState = {
  controllerId: string;
  value: string;
};

function buildDeviceSyncExample(controller: ControllerCard) {
  return {
    firmwareVersion: "1.0.0",
    readings: controller.channels.map((channel) => {
      switch (channel.template) {
        case "tank_level":
          return { channelKey: channel.channelKey, numericValue: 72, rawValue: 38, rawUnit: "cm", status: "ok" };
        case "soil_moisture":
          return { channelKey: channel.channelKey, numericValue: 44, rawValue: 2140, rawUnit: "adc", status: "ok" };
        case "turbidity":
          return { channelKey: channel.channelKey, numericValue: 27, rawValue: 27, rawUnit: "NTU", status: "ok" };
        case "fish_tank_level":
          return { channelKey: channel.channelKey, numericValue: 81, rawValue: 24, rawUnit: "cm", status: "ok" };
        case "battery_voltage":
          return { channelKey: channel.channelKey, numericValue: 12.4, rawValue: 12.4, rawUnit: "V", status: "ok" };
        case "pump":
        case "irrigation_valve":
        case "flush_valve":
        case "inlet_valve":
          return { channelKey: channel.channelKey, booleanState: false, numericValue: 0, status: "ok" };
        default:
          return { channelKey: channel.channelKey, numericValue: 0, status: "ok" };
      }
    }),
    acknowledgements: [],
  };
}

export function SettingsView({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState("");
  const [origin, setOrigin] = useState("");
  const [revealedKey, setRevealedKey] = useState<RevealedKeyState | null>(null);
  const [starterPresetId, setStarterPresetId] = useState<SetupPreset["id"]>("custom");
  const [bundleInstall, setBundleInstall] = useState({
    controllerId: initialSnapshot.controllers[0]?.id ?? "",
    presetId: "tank_automation" as Exclude<SetupPreset["id"], "custom">,
  });
  const [guideControllerId, setGuideControllerId] = useState(initialSnapshot.controllers[0]?.id ?? "");
  const [newController, setNewController] = useState({
    name: "",
    hardwareId: "",
    location: "",
    description: "",
    heartbeatIntervalSec: 60,
  });
  const [newChannel, setNewChannel] = useState<ChannelFormState>({
    controllerId: initialSnapshot.controllers[0]?.id ?? "",
    channelKey: "",
    name: "",
    template: "tank_level",
  });

  const controllerOptions = useMemo(() => snapshot.controllers.map((controller) => ({ id: controller.id, name: controller.name })), [snapshot.controllers]);
  const starterPreset = useMemo(() => getSetupPreset(starterPresetId), [starterPresetId]);
  const selectedTemplate = useMemo(() => getTemplate(newChannel.template), [newChannel.template]);
  const bundlePreset = useMemo(() => getSetupPreset(bundleInstall.presetId), [bundleInstall.presetId]);
  const selectedGuideController = useMemo(
    () => snapshot.controllers.find((controller) => controller.id === guideControllerId) ?? null,
    [guideControllerId, snapshot.controllers]
  );
  const selectedNewChannelController = useMemo(
    () => snapshot.controllers.find((controller) => controller.id === newChannel.controllerId) ?? null,
    [newChannel.controllerId, snapshot.controllers]
  );
  const guidePayload = useMemo(
    () => (selectedGuideController ? JSON.stringify(buildDeviceSyncExample(selectedGuideController), null, 2) : ""),
    [selectedGuideController]
  );
  const guideDeviceKey = revealedKey?.controllerId === guideControllerId ? revealedKey.value : "";

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const fallbackControllerId = snapshot.controllers[0]?.id ?? "";
    if (!snapshot.controllers.length) {
      setBundleInstall((current) => (current.controllerId ? { ...current, controllerId: "" } : current));
      setGuideControllerId((current) => (current ? "" : current));
      setNewChannel((current) => (current.controllerId ? { ...current, controllerId: "" } : current));
      return;
    }
    setBundleInstall((current) =>
      snapshot.controllers.some((controller) => controller.id === current.controllerId) ? current : { ...current, controllerId: fallbackControllerId }
    );
    setGuideControllerId((current) =>
      snapshot.controllers.some((controller) => controller.id === current) ? current : fallbackControllerId
    );
    setNewChannel((current) =>
      snapshot.controllers.some((controller) => controller.id === current.controllerId) ? current : { ...current, controllerId: fallbackControllerId }
    );
  }, [snapshot.controllers]);

  function normalizeToken(value: string) {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 20);
  }

  function normalizeChannelKey(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "")
      .slice(0, 32);
  }

  function buildSuggestedHardwareId(name: string) {
    return `ESP32-${normalizeToken(name || "CONTROLLER")}`;
  }

  function buildUniqueChannelKey(controllerId: string, baseKey: string, reservedKeys: Set<string> = new Set()) {
    const normalizedBase = normalizeChannelKey(baseKey) || "channel";
    const existingKeys = new Set(
      snapshot.controllers.find((controller) => controller.id === controllerId)?.channels.map((channel) => channel.channelKey) ?? []
    );
    let candidate = normalizedBase;
    let suffix = 2;
    while (existingKeys.has(candidate) || reservedKeys.has(candidate)) {
      candidate = `${normalizedBase}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function buildUniqueChannelName(controllerId: string, baseName: string, reservedNames: Set<string> = new Set()) {
    const trimmedBase = baseName.trim() || "Channel";
    const existingNames = new Set(
      snapshot.controllers.find((controller) => controller.id === controllerId)?.channels.map((channel) => channel.name.toLowerCase()) ?? []
    );
    let candidate = trimmedBase;
    let suffix = 2;
    while (existingNames.has(candidate.toLowerCase()) || reservedNames.has(candidate.toLowerCase())) {
      candidate = `${trimmedBase} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function buildSuggestedChannelKey(templateId: string, controllerId: string = newChannel.controllerId) {
    return buildUniqueChannelKey(controllerId, templateId);
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  function buildPresetChannels(controllerId: string, presetId: SetupPreset["id"]) {
    const preset = getSetupPreset(presetId);
    const reservedKeys = new Set<string>();
    const reservedNames = new Set<string>();
    const keyMap = new Map<string, string>();

    for (const channel of preset.channels) {
      const uniqueKey = buildUniqueChannelKey(controllerId, channel.channelKey, reservedKeys);
      reservedKeys.add(uniqueKey);
      keyMap.set(channel.channelKey, uniqueKey);
    }

    return preset.channels.map((channel) => {
      const template = getTemplate(channel.template);
      const mergedConfig = {
        ...template.config,
        ...(channel.config ?? {}),
      };
      const linkedKeys = Array.isArray(mergedConfig.linkedActuatorChannelKeys)
        ? mergedConfig.linkedActuatorChannelKeys.map((entry) => keyMap.get(String(entry)) ?? String(entry))
        : undefined;
      const nextName = buildUniqueChannelName(controllerId, channel.name, reservedNames);
      reservedNames.add(nextName.toLowerCase());

      return {
        channelKey: keyMap.get(channel.channelKey) ?? channel.channelKey,
        name: nextName,
        template: channel.template,
        config: linkedKeys ? { ...mergedConfig, linkedActuatorChannelKeys: linkedKeys } : mergedConfig,
      };
    });
  }

  async function refreshControllers() {
    const response = await fetch("/api/controllers", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    setSnapshot((await response.json()) as DashboardSnapshot);
  }

  async function createPresetChannels(controllerId: string, presetId: SetupPreset["id"]) {
    const presetChannels = buildPresetChannels(controllerId, presetId);
    for (const channel of presetChannels) {
      const response = await fetch(`/api/controllers/${controllerId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelKey: channel.channelKey,
          name: channel.name,
          template: channel.template,
          config: channel.config,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? `Could not create starter channel ${channel.name}.`);
      }
    }
  }

  async function handleProfileSubmit(formData: FormData) {
    setMessage("");
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        farmName: String(formData.get("farmName") ?? ""),
        location: String(formData.get("location") ?? ""),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not update profile.");
      return;
    }
    setSnapshot((current) => ({ ...current, user: data.user }));
    setMessage("Profile saved.");
  }

  async function createControllerRecord() {
    setMessage("");
    const payload = {
      ...newController,
      hardwareId: newController.hardwareId.trim() || buildSuggestedHardwareId(newController.name),
    };
    const response = await fetch("/api/controllers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not create controller.");
      return;
    }
    try {
      if (starterPresetId !== "custom") {
        await createPresetChannels(data.controller.id, starterPresetId);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Controller created, but starter channels could not be added.");
      await refreshControllers();
      return;
    }
    setRevealedKey({ controllerId: data.controller.id, value: data.deviceKey });
    setGuideControllerId(data.controller.id);
    setMessage(
      starterPresetId === "custom"
        ? "Controller created. Save the device key now."
        : `Controller created with the "${starterPreset.label}" bundle. Save the device key now.`
    );
    setNewController({
      name: "",
      hardwareId: "",
      location: "",
      description: "",
      heartbeatIntervalSec: 60,
    });
    setStarterPresetId("custom");
    setNewChannel((current) => ({
      ...current,
      controllerId: data.controller.id,
    }));
    await refreshControllers();
  }

  async function createChannelRecord() {
    setMessage("");
    const response = await fetch(`/api/controllers/${newChannel.controllerId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelKey: newChannel.channelKey || buildSuggestedChannelKey(newChannel.template, newChannel.controllerId),
        name: newChannel.name || selectedTemplate.label,
        template: newChannel.template,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not create channel.");
      return;
    }
    setMessage("Channel created.");
    setNewChannel((current) => ({
      ...current,
      channelKey: "",
      name: "",
    }));
    await refreshControllers();
  }

  function applyTemplateDefaults(templateId: string) {
    setNewChannel((current) => {
      const previousTemplate = getTemplate(current.template);
      const nextTemplate = getTemplate(templateId);
      const shouldReplaceName = !current.name || current.name === previousTemplate.label;
      const shouldReplaceKey = !current.channelKey || current.channelKey === buildSuggestedChannelKey(previousTemplate.id, current.controllerId);

      return {
        ...current,
        template: templateId,
        name: shouldReplaceName ? nextTemplate.label : current.name,
        channelKey: shouldReplaceKey ? buildSuggestedChannelKey(nextTemplate.id, current.controllerId) : current.channelKey,
      };
    });
  }

  async function applyBundleToController() {
    if (!bundleInstall.controllerId) {
      setMessage("Choose a controller first.");
      return;
    }
    setMessage("");
    try {
      await createPresetChannels(bundleInstall.controllerId, bundleInstall.presetId);
      await refreshControllers();
      setGuideControllerId(bundleInstall.controllerId);
      setMessage(`"${bundlePreset.label}" added to the selected controller.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add the starter bundle.");
    }
  }

  async function saveController(controllerId: string, payload: Record<string, unknown>) {
    setMessage("");
    const response = await fetch(`/api/controllers/${controllerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setMessage(response.ok ? "Controller updated." : data.error ?? "Could not update controller.");
    await refreshControllers();
  }

  async function deleteControllerRecord(controllerId: string) {
    if (!window.confirm("Delete this controller and all its channels?")) {
      return;
    }
    const response = await fetch(`/api/controllers/${controllerId}`, { method: "DELETE" });
    const data = await response.json();
    setMessage(response.ok ? "Controller deleted." : data.error ?? "Could not delete controller.");
    await refreshControllers();
  }

  async function rotateKey(controllerId: string) {
    const response = await fetch(`/api/controllers/${controllerId}/reset-key`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not rotate device key.");
      return;
    }
    setRevealedKey({ controllerId, value: data.deviceKey });
    setGuideControllerId(controllerId);
    setMessage("New device key generated. Save it now.");
  }

  async function saveChannel(channelId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setMessage(response.ok ? "Channel updated." : data.error ?? "Could not update channel.");
    await refreshControllers();
  }

  async function deleteChannelRecord(channelId: string) {
    const response = await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
    const data = await response.json();
    setMessage(response.ok ? "Channel deleted." : data.error ?? "Could not delete channel.");
    await refreshControllers();
  }

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Configuration</p>
          <h1>Account, ESP32 devices, and sensor setup</h1>
          <p className={styles.muted}>Manage private user dashboards, attach controllers, and define the channels each controller exposes.</p>
        </div>
      </header>

      {message ? <div className={styles.card}>{message}</div> : null}
      {revealedKey ? (
        <div className={styles.card}>
          <strong>One-time device key</strong>
          <p className={styles.muted}>{revealedKey.value}</p>
        </div>
      ) : null}

      <section className={styles.settingsGrid}>
        <article className={`${styles.settingsCard} ${styles.panel} ${styles.settingsWide}`}>
          <div>
            <p className={styles.eyebrow}>Quick start</p>
            <h2>Make onboarding almost one-click</h2>
            <p className={styles.muted}>Use a starter bundle, then point the ESP32 to the generated sync payload below.</p>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.card}>
              <strong>Recommended flow</strong>
              <ol className={styles.stepList}>
                <li>Create the ESP32 with a starter bundle such as Tank + Pump or Full GanSystems Starter.</li>
                <li>Save the one-time device key and upload the matching channel keys to the ESP32 firmware.</li>
                <li>Use the generated sync example to post sensor values and receive pending commands.</li>
              </ol>
            </div>
            <div className={styles.card}>
              <strong>Bundle existing controller</strong>
              <div className={styles.formGrid}>
                <label className={styles.formRow}>
                  <span>Controller</span>
                  <select
                    value={bundleInstall.controllerId}
                    onChange={(event) => setBundleInstall((current) => ({ ...current, controllerId: event.target.value }))}
                    disabled={!controllerOptions.length}
                  >
                    {controllerOptions.map((controller) => (
                      <option key={controller.id} value={controller.id}>
                        {controller.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.formRow}>
                  <span>Starter bundle</span>
                  <select
                    value={bundleInstall.presetId}
                    onChange={(event) =>
                      setBundleInstall((current) => ({
                        ...current,
                        presetId: event.target.value as Exclude<SetupPreset["id"], "custom">,
                      }))
                    }
                  >
                    {CONTROLLER_SETUP_PRESETS.filter((preset) => preset.id !== "custom").map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.muted}>{bundlePreset.description}</p>
                <div className={styles.tags}>
                  {bundlePreset.channels.map((channel) => (
                    <span key={channel.channelKey} className={styles.tag}>
                      {channel.name}
                    </span>
                  ))}
                </div>
                <button className={styles.button} type="button" onClick={() => void applyBundleToController()} disabled={!bundleInstall.controllerId}>
                  Add Bundle To Controller
                </button>
              </div>
            </div>
          </div>
        </article>

        <article className={`${styles.settingsCard} ${styles.panel} ${styles.settingsWide}`}>
          <div>
            <p className={styles.eyebrow}>Account profile</p>
            <h2>{snapshot.user.farmName}</h2>
          </div>
          <form
            className={styles.formGrid}
            action={async (formData) => {
              await handleProfileSubmit(formData);
            }}
          >
            <label className={styles.formRow}>
              <span>Full name</span>
              <input name="name" defaultValue={snapshot.user.name} required />
            </label>
            <label className={styles.formRow}>
              <span>Farm name</span>
              <input name="farmName" defaultValue={snapshot.user.farmName} required />
            </label>
            <div className={styles.twoCol}>
              <label className={styles.formRow}>
                <span>Location</span>
                <input name="location" defaultValue={snapshot.user.location} required />
              </label>
              <label className={styles.formRow}>
                <span>Email</span>
                <input name="email" type="email" defaultValue={snapshot.user.email} required />
              </label>
            </div>
            <button className={styles.button} type="submit">
              Save Profile
            </button>
          </form>
        </article>

        <article className={`${styles.settingsCard} ${styles.panel}`}>
          <div>
            <p className={styles.eyebrow}>Add ESP32</p>
            <h2>Register controller</h2>
            <p className={styles.muted}>You can create an empty ESP32 or let GanSystems add a starter bundle automatically.</p>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>Name</span>
              <input value={newController.name} onChange={(event) => setNewController({ ...newController, name: event.target.value })} />
            </label>
            <div className={styles.twoCol}>
              <label className={styles.formRow}>
                <span>Hardware ID</span>
                <input value={newController.hardwareId} onChange={(event) => setNewController({ ...newController, hardwareId: event.target.value })} />
              </label>
              <label className={styles.formRow}>
                <span>Location</span>
                <input value={newController.location} onChange={(event) => setNewController({ ...newController, location: event.target.value })} />
              </label>
            </div>
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => setNewController((current) => ({ ...current, hardwareId: buildSuggestedHardwareId(current.name) }))}
            >
              Suggest Hardware ID
            </button>
            <label className={styles.formRow}>
              <span>Description</span>
              <textarea value={newController.description} rows={3} onChange={(event) => setNewController({ ...newController, description: event.target.value })} />
            </label>
            <label className={styles.formRow}>
              <span>Heartbeat interval (seconds)</span>
              <input
                type="number"
                min={15}
                max={300}
                value={newController.heartbeatIntervalSec}
                onChange={(event) => setNewController({ ...newController, heartbeatIntervalSec: Number(event.target.value) || 60 })}
              />
            </label>
            <label className={styles.formRow}>
              <span>Starter bundle</span>
              <select value={starterPresetId} onChange={(event) => setStarterPresetId(event.target.value as SetupPreset["id"])}>
                {CONTROLLER_SETUP_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.card}>
              <strong>{starterPreset.label}</strong>
              <p className={styles.muted}>{starterPreset.description}</p>
              <div className={styles.tags}>
                {starterPreset.channels.length ? (
                  starterPreset.channels.map((channel) => <span key={channel.channelKey} className={styles.tag}>{channel.name}</span>)
                ) : (
                  <span className={styles.tag}>No starter channels</span>
                )}
              </div>
            </div>
            <button className={styles.button} type="button" onClick={() => void createControllerRecord()}>
              {starterPresetId === "custom" ? "Create Controller" : "Create Controller + Bundle"}
            </button>
          </div>
        </article>
      </section>

      <section className={styles.settingsGrid}>
        <article className={`${styles.settingsCard} ${styles.panel}`}>
          <div>
            <p className={styles.eyebrow}>ESP32 guide</p>
            <h2>Generated sync contract</h2>
            <p className={styles.muted}>Pick a controller and the app will show the exact endpoint, headers, and payload structure your ESP32 should use.</p>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>Controller guide</span>
              <select value={guideControllerId} onChange={(event) => setGuideControllerId(event.target.value)} disabled={!controllerOptions.length}>
                {controllerOptions.map((controller) => (
                  <option key={controller.id} value={controller.id}>
                    {controller.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedGuideController ? (
              <>
                <div className={styles.card}>
                  <div className={styles.rowBetween}>
                    <div>
                      <strong>Endpoint</strong>
                      <p className={styles.muted}>{origin ? `${origin}/api/device/sync` : "/api/device/sync"}</p>
                    </div>
                    <button
                      className={styles.ghostButton}
                      type="button"
                      onClick={() => void copyText("Endpoint", origin ? `${origin}/api/device/sync` : "/api/device/sync")}
                    >
                      Copy Endpoint
                    </button>
                  </div>
                  <div className={styles.formGrid}>
                    <div>
                      <strong className={styles.inlineLabel}>x-device-id</strong>
                      <p className={styles.muted}>{selectedGuideController.hardwareId}</p>
                    </div>
                    <div>
                      <strong className={styles.inlineLabel}>x-device-key</strong>
                      <p className={styles.muted}>{guideDeviceKey || "Create or rotate the key to reveal it once here."}</p>
                    </div>
                  </div>
                </div>

                <div className={styles.card}>
                  <div className={styles.rowBetween}>
                    <div>
                      <strong>Registered channel keys</strong>
                      <p className={styles.muted}>Use these exact keys inside your firmware when you build the readings array.</p>
                    </div>
                    <button className={styles.ghostButton} type="button" onClick={() => void copyText("Channel list", guidePayload)}>
                      Copy Payload
                    </button>
                  </div>
                  <div className={styles.tags}>
                    {selectedGuideController.channels.length ? (
                      selectedGuideController.channels.map((channel) => (
                        <span key={channel.id} className={styles.tag}>
                          {channel.channelKey}
                        </span>
                      ))
                    ) : (
                      <span className={styles.tag}>No channels yet</span>
                    )}
                  </div>
                </div>

                <div className={styles.codeBlock}>
                  <pre>{guidePayload}</pre>
                </div>
              </>
            ) : (
              <div className={styles.empty}>Create a controller first to generate the ESP32 sync guide.</div>
            )}
          </div>
        </article>

        <article className={`${styles.settingsCard} ${styles.panel}`}>
          <div>
            <p className={styles.eyebrow}>Add channel</p>
            <h2>Attach sensor or actuator</h2>
            <p className={styles.muted}>Pick a template and let the app suggest the channel name and key.</p>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>Controller</span>
              <select value={newChannel.controllerId} onChange={(event) => setNewChannel({ ...newChannel, controllerId: event.target.value })}>
                {controllerOptions.map((controller) => (
                  <option key={controller.id} value={controller.id}>
                    {controller.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.twoCol}>
              <label className={styles.formRow}>
                <span>Channel key</span>
                <input value={newChannel.channelKey} onChange={(event) => setNewChannel({ ...newChannel, channelKey: event.target.value })} />
              </label>
              <label className={styles.formRow}>
                <span>Name</span>
                <input value={newChannel.name} onChange={(event) => setNewChannel({ ...newChannel, name: event.target.value })} />
              </label>
            </div>
            <label className={styles.formRow}>
              <span>Template</span>
              <select value={newChannel.template} onChange={(event) => applyTemplateDefaults(event.target.value)}>
                {CHANNEL_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.card}>
              <strong>{selectedTemplate.label}</strong>
              <p className={styles.muted}>
                Suggested key: {buildSuggestedChannelKey(selectedTemplate.id, newChannel.controllerId)} / Range: {selectedTemplate.minValue} to{" "}
                {selectedTemplate.maxValue} {selectedTemplate.unit}
              </p>
              {selectedNewChannelController ? (
                <p className={styles.small}>
                  Controller currently has {selectedNewChannelController.channels.length} channel(s). Suggested keys auto-increment when duplicates already exist.
                </p>
              ) : null}
              <div className={styles.actions}>
                <button
                  className={styles.ghostButton}
                  type="button"
                  onClick={() =>
                    setNewChannel((current) => ({
                      ...current,
                      channelKey: buildSuggestedChannelKey(selectedTemplate.id, current.controllerId),
                      name: selectedTemplate.label,
                    }))
                  }
                >
                  Use Template Defaults
                </button>
              </div>
            </div>
            <button className={styles.button} type="button" onClick={() => void createChannelRecord()} disabled={!newChannel.controllerId}>
              Add Channel
            </button>
          </div>
        </article>

        <article className={`${styles.settingsCard} ${styles.panel}`}>
          <div>
            <p className={styles.eyebrow}>Current inventory</p>
            <h2>{snapshot.controllers.length} registered controller(s)</h2>
          </div>
          <div className={styles.controllerStack}>
            {snapshot.controllers.length ? (
              snapshot.controllers.map((controller) => (
                <article key={controller.id} className={styles.card}>
                  <div className={styles.rowBetween}>
                    <div>
                      <strong>{controller.name}</strong>
                      <p className={styles.muted}>
                        {controller.hardwareId} / {controller.location}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <button className={styles.ghostButton} type="button" onClick={() => void rotateKey(controller.id)}>
                        Rotate Key
                      </button>
                      <button className={styles.dangerButton} type="button" onClick={() => void deleteControllerRecord(controller.id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className={styles.formGrid}>
                    <label className={styles.formRow}>
                      <span>Description</span>
                      <textarea
                        rows={2}
                        defaultValue={controller.description}
                        onBlur={(event) => void saveController(controller.id, { description: event.target.value })}
                      />
                    </label>
                    <label className={styles.formRow}>
                      <span>Heartbeat interval</span>
                      <input
                        type="number"
                        min={15}
                        max={300}
                        defaultValue={controller.heartbeatIntervalSec}
                        onBlur={(event) => void saveController(controller.id, { heartbeatIntervalSec: Number(event.target.value) || 60 })}
                      />
                    </label>
                  </div>

                  <div className={styles.channelList}>
                    {controller.channels.map((channel) => (
                      <div key={channel.id} className={styles.card}>
                        <div className={styles.rowBetween}>
                          <div>
                            <strong>{channel.name}</strong>
                            <p className={styles.small}>{channel.channelKey}</p>
                          </div>
                          <button className={styles.dangerButton} type="button" onClick={() => void deleteChannelRecord(channel.id)}>
                            Remove
                          </button>
                        </div>
                        <div className={styles.twoCol}>
                          <label className={styles.formRow}>
                            <span>Name</span>
                            <input defaultValue={channel.name} onBlur={(event) => void saveChannel(channel.id, { name: event.target.value })} />
                          </label>
                          <label className={styles.formRow}>
                            <span>Template</span>
                            <select defaultValue={channel.template} onChange={(event) => void saveChannel(channel.id, { template: event.target.value })}>
                              {CHANNEL_TEMPLATES.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className={styles.twoCol}>
                          <label className={styles.formRow}>
                            <span>Config JSON</span>
                            <textarea
                              rows={3}
                              defaultValue={JSON.stringify(channel.config, null, 2)}
                              onBlur={(event) => {
                                try {
                                  void saveChannel(channel.id, { config: JSON.parse(event.target.value) });
                                } catch {
                                  setMessage(`Invalid JSON for ${channel.name} config.`);
                                }
                              }}
                            />
                          </label>
                          <label className={styles.formRow}>
                            <span>Calibration JSON</span>
                            <textarea
                              rows={3}
                              defaultValue={JSON.stringify(channel.calibration, null, 2)}
                              onBlur={(event) => {
                                try {
                                  void saveChannel(channel.id, { calibration: JSON.parse(event.target.value) });
                                } catch {
                                  setMessage(`Invalid JSON for ${channel.name} calibration.`);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className={styles.empty}>No controllers registered yet.</div>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
