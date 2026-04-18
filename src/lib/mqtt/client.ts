import mqtt, { type MqttClient } from "mqtt";

import { deviceSync } from "@/lib/services/device-sync.service";
import { applyAcknowledgements } from "@/lib/services/command.service";
import { broadcastToUser } from "@/lib/ws/server";
import { getControllerSnapshot } from "@/lib/services/snapshot.service";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { controllers } from "@/lib/db/schema";

const TOPIC_READINGS = "gansys/+/readings";
const TOPIC_ACKS = "gansys/+/acks";
const TOPIC_SNAPSHOT = "gansys/+/snapshot";

declare global {
  // eslint-disable-next-line no-var
  var __gansys_mqtt__: MqttClient | undefined;
}

function getHardwareId(topic: string): string {
  // topic format: gansys/{hardwareId}/readings
  return topic.split("/")[1] ?? "";
}

function createMqttClient(): MqttClient {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.warn("[MQTT] MQTT_BROKER_URL not set — MQTT client disabled.");
    // Return a no-op client stub so the rest of the app doesn't crash
    return { publish: () => {}, end: () => {} } as unknown as MqttClient;
  }

  const client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
  });

  client.on("connect", () => {
    console.log("[MQTT] Connected to broker.");
    client.subscribe([TOPIC_READINGS, TOPIC_ACKS, TOPIC_SNAPSHOT], { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] Subscribe error:", err);
    });
  });

  client.on("error", (err) => console.error("[MQTT] Error:", err));
  client.on("reconnect", () => console.log("[MQTT] Reconnecting..."));

  client.on("message", (topic, payload) => {
    const hardwareId = getHardwareId(topic);
    if (!hardwareId) return;

    try {
      const body = JSON.parse(payload.toString()) as Record<string, unknown>;

      if (topic.endsWith("/readings")) {
        void handleReadings(hardwareId, body);
      } else if (topic.endsWith("/acks")) {
        void handleAcks(hardwareId, body);
      } else if (topic.endsWith("/snapshot")) {
        void handleSnapshot(hardwareId, body);
      }
    } catch (err) {
      console.error(`[MQTT] Failed to process message on ${topic}:`, err);
    }
  });

  return client;
}

async function getControllerByHardwareId(hardwareId: string) {
  const rows = await db.select().from(controllers).where(eq(controllers.hardwareId, hardwareId));
  return rows[0] ?? null;
}

async function handleReadings(hardwareId: string, body: Record<string, unknown>) {
  // Reuse the device key from the sync endpoint — MQTT messages are pre-authenticated
  // by the broker (TLS + username/password), so we look up the controller directly.
  const controller = await getControllerByHardwareId(hardwareId);
  if (!controller) {
    console.warn(`[MQTT] Unknown hardwareId: ${hardwareId}`);
    return;
  }

  const result = await deviceSync(hardwareId, "", body as Parameters<typeof deviceSync>[2], true);
  publishCommands(hardwareId, {
    commands: result.pendingCommands,
    pestControlSchedule: result.pestControlSchedule,
  });

  // Broadcast updated snapshot to all open browser sessions for this user
  try {
    const snapshot = await getControllerSnapshot(controller.userId, controller.id);
    broadcastToUser(controller.userId, { type: "controller_update", data: snapshot.controller });
  } catch (err) {
    console.error("[MQTT] Broadcast error:", err);
  }
}

async function handleAcks(hardwareId: string, body: Record<string, unknown>) {
  const controller = await getControllerByHardwareId(hardwareId);
  if (!controller) return;

  const acks = Array.isArray(body.acknowledgements) ? body.acknowledgements : [];
  await applyAcknowledgements(controller.userId, controller.id, acks);

  try {
    const snapshot = await getControllerSnapshot(controller.userId, controller.id);
    broadcastToUser(controller.userId, { type: "controller_update", data: snapshot.controller });
  } catch (err) {
    console.error("[MQTT] Broadcast error after acks:", err);
  }
}

async function handleSnapshot(hardwareId: string, body: Record<string, unknown>) {
  // Camera snapshot arrives as { channelKey, imageUrl?, imageBase64? }
  // Delegate to the readings handler with a synthetic reading payload
  const controller = await getControllerByHardwareId(hardwareId);
  if (!controller) return;

  const channelKey = typeof body.channelKey === "string" ? body.channelKey : null;
  if (!channelKey) return;

  await deviceSync(hardwareId, "", {
    readings: [{
      channelKey,
      payload: {
        imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
        imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : null,
      },
      status: "ok",
    }],
  }, true);

  try {
    const snapshot = await getControllerSnapshot(controller.userId, controller.id);
    broadcastToUser(controller.userId, {
      type: "snapshot_update",
      data: { channelId: channelKey, snapshot: snapshot.latestSnapshots[channelKey] ?? { imageUrl: null, imageBase64: null } },
    });
  } catch (err) {
    console.error("[MQTT] Broadcast error after snapshot:", err);
  }
}

export function publishCommands(hardwareId: string, payload: unknown): void {
  if (!mqttClient || typeof (mqttClient as MqttClient).publish !== "function") return;
  const topic = `gansys/${hardwareId}/commands`;
  (mqttClient as MqttClient).publish(topic, JSON.stringify(payload), { qos: 1, retain: true }, (err) => {
    if (err) console.error(`[MQTT] Publish error on ${topic}:`, err);
  });
}

// Singleton — reuse across hot reloads in dev
export const mqttClient: MqttClient =
  globalThis.__gansys_mqtt__ ?? createMqttClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__gansys_mqtt__ = mqttClient;
}
