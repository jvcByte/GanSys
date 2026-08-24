import { useState, useEffect } from "react";
import type { ControllerCard } from "@/lib/types";
import styles from "@/components/dashboard/dashboard.module.css";

type Props = {
  controller: ControllerCard;
  deviceKey: string;
  onConnected: () => void;
};

export function DeviceConnectionStep({ controller, deviceKey, onConnected }: Props) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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
          case "spray_pump":
          case "uv_zapper":
            return { channelKey: channel.channelKey, booleanState: false, numericValue: 0, status: "ok" };
          case "camera_snapshot":
            return { channelKey: channel.channelKey, payload: { imageUrl: "https://example.com/snapshot.jpg" }, status: "ok" };
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

  function copyText(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadSecretsH() {
    const endpoint = origin ? `${origin}/api/device/sync` : "/api/device/sync";
    const deviceId = controller.hardwareId;
    const connectionCode = deviceKey;
    const channelKeys = controller.channels.map(ch => ch.channelKey).join(", ");

    const content = `// Wi-Fi configuration
// Add your Wi-Fi credentials here
#define WIFI_SSID "your_wifi_ssid"
#define WIFI_PASSWORD "your_wifi_password"

// Server configuration
#define SERVER_URL "${endpoint}"

// Device configuration
#define DEVICE_ID "${deviceId}"
#define DEVICE_KEY "${connectionCode}"

// Channel keys
#define CHANNEL_KEYS "${channelKeys}"

// Keep this configuration private. You may need it to connect your device.
`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "secrets.h";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildFullConfiguration() {
    const endpoint = origin ? `${origin}/api/device/sync` : "/api/device/sync";
    const deviceId = controller.hardwareId;
    const connectionCode = deviceKey;
    const channelKeys = controller.channels.map(ch => ch.channelKey).join(", ");

    return `// Server Configuration
Server URL: ${endpoint}
Device ID: ${deviceId}
Connection Code: ${connectionCode}

// Channel Keys
${channelKeys}

// Example payload structure:
${JSON.stringify(buildDeviceSyncExample(controller), null, 2)}`;
  }

  const fullConfig = buildFullConfiguration();

  return (
    <div className={styles.card}>
      <div style={{ marginBottom: "2rem" }}>
        <p className={styles.eyebrow}>Step 3 of 3</p>
        <h2 style={{ margin: "0.5rem 0 0.5rem" }}>Connect your device</h2>
        <p className={styles.muted}>
          Your device has been registered. Use the configuration below to connect your ESP32.
        </p>
      </div>

      <div className={styles.card} style={{ background: "var(--surface-hover)", marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <strong>Device Information</strong>
          <p className={styles.muted} style={{ margin: "0.3rem 0 0" }}>
            {controller.name} ({controller.location || "No location"})
          </p>
        </div>

        <div className={styles.formGrid}>
          <div>
            <strong className={styles.inlineLabel}>Server Endpoint</strong>
            <p className={styles.muted} style={{ fontSize: "0.9rem" }}>
              {origin ? `${origin}/api/device/sync` : "/api/device/sync"}
            </p>
          </div>
          <div>
            <strong className={styles.inlineLabel}>Device ID</strong>
            <p className={styles.muted} style={{ fontSize: "0.9rem" }}>
              {controller.hardwareId}
            </p>
          </div>
          <div>
            <strong className={styles.inlineLabel}>Connection Code</strong>
            <p className={styles.muted} style={{ fontSize: "0.9rem" }}>
              {deviceKey}
            </p>
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <strong className={styles.inlineLabel}>Channel Keys</strong>
          <div className={styles.tags} style={{ marginTop: "0.5rem" }}>
            {controller.channels.length ? (
              controller.channels.map((channel) => (
                <span key={channel.id} className={styles.tag}>
                  {channel.channelKey}
                </span>
              ))
            ) : (
              <span className={styles.tag}>No channels yet</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <button
          className={styles.button}
          onClick={() => copyText("Configuration", fullConfig)}
          style={{ flex: 1 }}
        >
          {copied ? "✓ Configuration copied" : "Copy configuration"}
        </button>
        <button
          className={styles.ghostButton}
          onClick={downloadSecretsH}
          style={{ flex: 1 }}
        >
          Download secrets.h
        </button>
      </div>

      <div className={styles.codeBlock}>
        <pre>{fullConfig}</pre>
      </div>

      <div className={styles.card} style={{ background: "var(--primary-dim)", marginTop: "1.5rem", padding: "1rem" }}>
        <p className={styles.muted} style={{ margin: 0, fontSize: "0.9rem" }}>
          ⚠️ Keep this configuration private. You may need it to connect your device.
        </p>
      </div>

      <button
        className={styles.button}
        onClick={onConnected}
        style={{ width: "100%", marginTop: "1.5rem" }}
      >
        I've configured my device
      </button>
    </div>
  );
}