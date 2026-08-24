import type { SetupPreset } from "@/lib/templates";
import styles from "@/components/dashboard/dashboard.module.css";

type Props = {
  presets: SetupPreset[];
  selectedPresetId: SetupPreset["id"];
  onSelectPreset: (presetId: SetupPreset["id"]) => void;
  onNext: () => void;
};

export function SetupTypeStep({ presets, selectedPresetId, onSelectPreset, onNext }: Props) {
  const getPresetIcon = (id: SetupPreset["id"]) => {
    switch (id) {
      case "tank_automation": return "💧";
      case "irrigation_zone": return "🌱";
      case "aquaculture_tank": return "🐟";
      case "pest_control": return "🦟";
      case "full_gansystems": return "🏭";
      default: return "📦";
    }
  };

  const getPresetFriendlyName = (preset: SetupPreset) => {
    switch (preset.id) {
      case "tank_automation": return "Water Tank + Pump";
      case "irrigation_zone": return "Irrigation Zone";
      case "aquaculture_tank": return "Fish Pond";
      case "pest_control": return "Pest Control";
      case "full_gansystems": return "Complete Farm Setup";
      default: return preset.label;
    }
  };

  return (
    <div className={styles.card}>
      <div style={{ marginBottom: "2rem" }}>
        <p className={styles.eyebrow}>Step 1 of 3</p>
        <h2 style={{ margin: "0.5rem 0 0.5rem" }}>What are you setting up?</h2>
        <p className={styles.muted}>Choose the type of device you want to connect to your farm.</p>
      </div>

      <div style={{ display: "grid", gap: "1rem", marginBottom: "2rem" }}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelectPreset(preset.id)}
            className={`${styles.card} ${styles.controllerCard}`}
            style={{
              padding: "1.2rem",
              textAlign: "left",
              border: selectedPresetId === preset.id ? "2px solid var(--primary)" : "1px solid var(--line)",
              background: selectedPresetId === preset.id ? "var(--primary-dim)" : "var(--surface)",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (selectedPresetId !== preset.id) {
                e.currentTarget.style.borderColor = "var(--primary)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }
            }}
            onMouseLeave={(e) => {
              if (selectedPresetId !== preset.id) {
                e.currentTarget.style.borderColor = "var(--line)";
                e.currentTarget.style.transform = "translateY(0)";
              }
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ fontSize: "2rem" }}>{getPresetIcon(preset.id)}</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem" }}>
                  {getPresetFriendlyName(preset)}
                </h3>
                <p className={styles.muted} style={{ margin: 0, fontSize: "0.9rem" }}>
                  {preset.description}
                </p>
              </div>
              {selectedPresetId === preset.id && (
                <span style={{ color: "var(--primary)", fontSize: "1.2rem" }}>✓</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <button
        className={styles.button}
        onClick={onNext}
        disabled={!selectedPresetId}
        style={{ width: "100%", opacity: !selectedPresetId ? 0.5 : 1 }}
      >
        Continue
      </button>
    </div>
  );
}