import type { SetupPreset } from "@/lib/templates";
import styles from "@/components/dashboard/dashboard.module.css";

type Props = {
  deviceName: string;
  deviceLocation: string;
  advancedSettings: {
    hardwareId: string;
    description: string;
    heartbeatIntervalSec: number;
  };
  showAdvanced: boolean;
  selectedPreset: SetupPreset;
  onDeviceNameChange: (value: string) => void;
  onDeviceLocationChange: (value: string) => void;
  onAdvancedSettingsChange: (settings: {
    hardwareId: string;
    description: string;
    heartbeatIntervalSec: number;
  }) => void;
  onToggleAdvanced: () => void;
  onBack: () => void;
  onNext: () => void;
};

export function DeviceDetailsStep({
  deviceName,
  deviceLocation,
  advancedSettings,
  showAdvanced,
  selectedPreset,
  onDeviceNameChange,
  onDeviceLocationChange,
  onAdvancedSettingsChange,
  onToggleAdvanced,
  onBack,
  onNext,
}: Props) {
  const buildSuggestedHardwareId = (name: string) => {
    const normalizeToken = (str: string) => str.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return `ESP32-${normalizeToken(name || "CONTROLLER")}`;
  };

  const suggestedHardwareId = buildSuggestedHardwareId(deviceName);

  return (
    <div className={styles.card}>
      <div style={{ marginBottom: "2rem" }}>
        <p className={styles.eyebrow}>Step 2 of 3</p>
        <h2 style={{ margin: "0.5rem 0 0.5rem" }}>Give your device a name</h2>
        <p className={styles.muted}>
          Setting up: <strong>{selectedPreset.label}</strong>
        </p>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formRow}>
          <span>Device name *</span>
          <input
            value={deviceName}
            onChange={(e) => onDeviceNameChange(e.target.value)}
            placeholder="e.g., Back Farm Water Tank"
            style={{ width: "100%" }}
          />
        </label>

        <label className={styles.formRow}>
          <span>Location (optional)</span>
          <input
            value={deviceLocation}
            onChange={(e) => onDeviceLocationChange(e.target.value)}
            placeholder="e.g., Main Farm"
            style={{ width: "100%" }}
          />
        </label>

        <button
          className={styles.ghostButton}
          type="button"
          onClick={onToggleAdvanced}
          style={{ width: "100%", textAlign: "left" }}
        >
          {showAdvanced ? "▼" : "▶"} Advanced settings
        </button>

        {showAdvanced && (
          <div className={styles.card} style={{ background: "var(--surface-hover)", padding: "1rem" }}>
            <label className={styles.formRow}>
              <span>Device ID / Hardware ID</span>
              <input
                value={advancedSettings.hardwareId || suggestedHardwareId}
                onChange={(e) => onAdvancedSettingsChange({ ...advancedSettings, hardwareId: e.target.value })}
                placeholder={suggestedHardwareId}
                style={{ width: "100%" }}
              />
              <p className={styles.small} style={{ margin: "0.3rem 0 0" }}>
                Auto-generated: {suggestedHardwareId}
              </p>
            </label>

            <label className={styles.formRow}>
              <span>Description</span>
              <textarea
                value={advancedSettings.description}
                onChange={(e) => onAdvancedSettingsChange({ ...advancedSettings, description: e.target.value })}
                rows={3}
                placeholder="Optional description..."
                style={{ width: "100%" }}
              />
            </label>

            <label className={styles.formRow}>
              <span>Heartbeat interval (seconds)</span>
              <input
                type="number"
                min={15}
                max={300}
                value={advancedSettings.heartbeatIntervalSec}
                onChange={(e) => onAdvancedSettingsChange({ 
                  ...advancedSettings, 
                  heartbeatIntervalSec: Number(e.target.value) || 60 
                })}
                style={{ width: "100%" }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
        <button className={styles.ghostButton} onClick={onBack} style={{ flex: 1 }}>
          Back
        </button>
        <button
          className={styles.button}
          onClick={onNext}
          disabled={!deviceName.trim()}
          style={{ flex: 1, opacity: !deviceName.trim() ? 0.5 : 1 }}
        >
          Create Device
        </button>
      </div>
    </div>
  );
}