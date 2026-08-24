"use client";

import { useState } from "react";
import { useWs } from "@/lib/ws-context";
import type { ControllerCard } from "@/lib/types";
import { CONTROLLER_SETUP_PRESETS, getSetupPreset, type SetupPreset } from "@/lib/templates";
import { SetupTypeStep } from "./setup-type-step";
import { DeviceDetailsStep } from "./device-details-step";
import { DeviceConnectionStep } from "./device-connection-step";
import { DeviceConnectedState } from "./device-connected-state";
import styles from "@/components/dashboard/dashboard.module.css";

type WizardStep = "setup_type" | "device_details" | "creating" | "device_connection" | "waiting_for_device" | "connected" | "complete" | "error";

type Props = {
  initialSnapshot: {
    user: { id: string };
    controllers: ControllerCard[];
  };
  onComplete?: () => void;
};

export function AddDeviceWizard({ initialSnapshot, onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("setup_type");
  const [selectedPresetId, setSelectedPresetId] = useState<SetupPreset["id"]>("tank_automation");
  const [deviceName, setDeviceName] = useState("");
  const [deviceLocation, setDeviceLocation] = useState("");
  const [advancedSettings, setAdvancedSettings] = useState({
    hardwareId: "",
    description: "",
    heartbeatIntervalSec: 60,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [createdController, setCreatedController] = useState<ControllerCard | null>(null);
  const [deviceKey, setDeviceKey] = useState("");
  const [error, setError] = useState("");
  const { lastMessage, connected } = useWs();

  // Watch for controller updates via WebSocket
  if (createdController && lastMessage?.type === "controller_update" && lastMessage.data.id === createdController.id) {
    if (currentStep === "waiting_for_device" && lastMessage.data.status === "online") {
      setCreatedController(lastMessage.data);
      setCurrentStep("connected");
    }
  }

  const selectedPreset = getSetupPreset(selectedPresetId);

  function buildSuggestedHardwareId(name: string) {
    const normalizeToken = (str: string) => str.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return `ESP32-${normalizeToken(name || "CONTROLLER")}`;
  }

  async function createDevice() {
    setError("");
    setCurrentStep("creating");

    const hardwareId = advancedSettings.hardwareId.trim() || buildSuggestedHardwareId(deviceName);
    
    try {
      const response = await fetch("/api/controllers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: deviceName.trim(),
          hardwareId,
          location: deviceLocation.trim(),
          description: advancedSettings.description.trim(),
          heartbeatIntervalSec: advancedSettings.heartbeatIntervalSec,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not create device.");
      }

      // Create preset channels if not custom
      if (selectedPresetId !== "custom") {
        const presetChannels = buildPresetChannels(data.controller.id, selectedPresetId);
        for (const channel of presetChannels) {
          const channelResponse = await fetch(`/api/controllers/${data.controller.id}/channels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channelKey: channel.channelKey,
              name: channel.name,
              template: channel.template,
              config: channel.config,
            }),
          });
          if (!channelResponse.ok) {
            throw new Error(`Could not create starter channel ${channel.name}.`);
          }
        }
      }

      setCreatedController(data.controller);
      setDeviceKey(data.deviceKey);
      setCurrentStep("device_connection");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create device.");
      setCurrentStep("error");
    }
  }

  function buildPresetChannels(controllerId: string, presetId: SetupPreset["id"]) {
    const preset = getSetupPreset(presetId);
    if (!preset || presetId === "custom") return [];

    const reservedKeys = new Set<string>();
    const reservedNames = new Set<string>();
    const keyMap = new Map<string, string>();

    const normalizeToken = (str: string) => str.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const buildUniqueChannelKey = (baseKey: string) => {
      let key = baseKey;
      let counter = 1;
      while (reservedKeys.has(key)) {
        key = `${baseKey}_${counter}`;
        counter++;
      }
      reservedKeys.add(key);
      return key;
    };

    const buildUniqueChannelName = (baseName: string) => {
      let name = baseName;
      let counter = 1;
      while (reservedNames.has(name.toLowerCase())) {
        name = `${baseName} ${counter}`;
        counter++;
      }
      reservedNames.add(name.toLowerCase());
      return name;
    };

    for (const channel of preset.channels) {
      const uniqueKey = buildUniqueChannelKey(channel.channelKey);
      reservedKeys.add(uniqueKey);
      keyMap.set(channel.channelKey, uniqueKey);
    }

    return preset.channels.map((channel) => {
      const linkedKeys = Array.isArray(channel.config?.linkedActuatorChannelKeys)
        ? channel.config.linkedActuatorChannelKeys.map((entry) => keyMap.get(String(entry)) ?? String(entry))
        : undefined;
      const nextName = buildUniqueChannelName(channel.name);
      reservedNames.add(nextName.toLowerCase());

      return {
        channelKey: keyMap.get(channel.channelKey) ?? channel.channelKey,
        name: nextName,
        template: channel.template,
        config: linkedKeys ? { ...channel.config, linkedActuatorChannelKeys: linkedKeys } : channel.config,
      };
    });
  }

  function handleBack() {
    if (currentStep === "device_details") {
      setCurrentStep("setup_type");
    } else if (currentStep === "error") {
      setCurrentStep("device_details");
    }
  }

  function handleRetry() {
    if (currentStep === "error") {
      createDevice();
    }
  }

  function handleComplete() {
    onComplete?.();
  }

  return (
    <div className={styles.panel}>
      {currentStep === "setup_type" && (
        <SetupTypeStep
          presets={CONTROLLER_SETUP_PRESETS.filter(p => p.id !== "custom")}
          selectedPresetId={selectedPresetId}
          onSelectPreset={setSelectedPresetId}
          onNext={() => setCurrentStep("device_details")}
        />
      )}

      {currentStep === "device_details" && (
        <DeviceDetailsStep
          deviceName={deviceName}
          deviceLocation={deviceLocation}
          advancedSettings={advancedSettings}
          showAdvanced={showAdvanced}
          selectedPreset={selectedPreset}
          onDeviceNameChange={setDeviceName}
          onDeviceLocationChange={setDeviceLocation}
          onAdvancedSettingsChange={setAdvancedSettings}
          onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
          onBack={handleBack}
          onNext={createDevice}
        />
      )}

      {currentStep === "creating" && (
        <div className={styles.card} style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⏳</div>
          <h2>Creating your device...</h2>
          <p className={styles.muted}>Please wait while we set up your device.</p>
        </div>
      )}

      {currentStep === "device_connection" && createdController && (
        <DeviceConnectionStep
          controller={createdController}
          deviceKey={deviceKey}
          onConnected={() => setCurrentStep("waiting_for_device")}
        />
      )}

      {currentStep === "waiting_for_device" && createdController && (
        <div className={styles.card} style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📡</div>
          <h2>Waiting for your device</h2>
          <p className={styles.muted}>Connect and start your ESP32. We'll automatically detect it when it comes online.</p>
          <div className={styles.progress} style={{ margin: "2rem auto", maxWidth: "200px" }}>
            <span style={{ animation: "pulse 2s infinite" }}></span>
          </div>
        </div>
      )}

      {currentStep === "connected" && createdController && (
        <DeviceConnectedState
          controller={createdController}
          onComplete={handleComplete}
        />
      )}

      {currentStep === "error" && (
        <div className={styles.card} style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚠️</div>
          <h2>Couldn't create your device</h2>
          <p className={styles.muted}>{error || "We couldn't register this device. Please try again."}</p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "2rem" }}>
            <button className={styles.ghostButton} onClick={handleBack}>
              Back
            </button>
            <button className={styles.button} onClick={handleRetry}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}