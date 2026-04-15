# Requirements Document

## Introduction

GanSystems is a farm monitoring dashboard that gives farmers a single place to watch everything happening on their farm in real time. ESP32 microcontrollers (and ESP32-CAM units for camera feeds) are deployed across the farm and send sensor readings to the web application. The farmer opens the dashboard and can see live sensor values, camera snapshots, alerts, and history charts for every part of the farm — irrigation zones, fish pond, water supply, and pest control areas.

This document covers the full scope of the farm monitoring dashboard, including the five farm activity areas and the new pest control subsystem that is being added. The pest control subsystem introduces two new actuator channel types (spray pump and UV zapper), a camera snapshot feed for visual weed inspection, a time-based pest control schedule, and a pest control activity log.

## Glossary

- **Dashboard**: The GanSystems web application that farmers use to monitor and control their farm.
- **Controller**: An ESP32 microcontroller registered in the system. Each controller has a unique hardware ID and device key, and reports sensor readings via `POST /api/device/sync`.
- **Camera_Controller**: An ESP32-CAM controller that captures field images and posts snapshot data to the dashboard.
- **Channel**: A single data stream on a controller — either a sensor (reads a value) or an actuator (receives on/off commands).
- **Channel_Template**: A predefined channel type that sets default units, thresholds, and display config. Existing templates: `tank_level`, `soil_moisture`, `turbidity`, `fish_tank_level`, `pump`, `irrigation_valve`, `flush_valve`, `inlet_valve`, `battery_voltage`. New templates: `spray_pump`, `uv_zapper`, `camera_snapshot`.
- **Setup_Preset**: A named bundle of channels that can be applied to a controller in one click from the Settings page.
- **Sensor_Card**: A UI card on the Controller Detail page that shows the latest reading for a sensor channel and any linked actuator controls.
- **Pest_Control_Schedule**: A configuration object stored on the server that defines when the spray pump should run and when the UV zapper should activate. The ESP32 reads this schedule on each sync.
- **Pest_Control_Log**: A list of recent spray pump and UV zapper activation events shown on the dashboard.
- **Snapshot**: A still image captured by an ESP32-CAM and associated with a `camera_snapshot` channel. Stored as a URL or base64 string.
- **Manual_Override**: A temporary command sent from the dashboard that forces an actuator on or off for a fixed number of minutes, after which the device resumes normal operation.
- **Alert**: A system-generated notification shown on the dashboard when a sensor reading crosses a threshold or a controller goes offline.

---

## Requirements

### Requirement 1: Live Farm Overview Dashboard

**User Story:** As a farmer, I want to open the dashboard and immediately see the health of my whole farm, so that I can spot problems without clicking into each controller.

#### Acceptance Criteria

1. THE Dashboard SHALL display a summary section showing the total number of registered controllers, how many are currently online, the total number of open alerts broken down by severity (critical and warning), the average soil moisture across all soil moisture channels, and the average main tank level across all tank level channels.
2. WHEN the Dashboard is open, THE Dashboard SHALL refresh the summary data every 5 seconds without requiring a page reload.
3. WHEN a controller has not sent a sync request within twice its configured heartbeat interval, THE Dashboard SHALL display that controller's status as "stale".
4. WHEN a controller has not sent a sync request within 5 minutes, THE Dashboard SHALL display that controller's status as "offline".
5. THE Dashboard SHALL display a card for each registered controller showing the controller name, location, hardware ID, firmware version, last-seen time, online/stale/offline status, channel count, and open alert count.
6. THE Dashboard SHALL display a list of all open alerts across all controllers, ordered by severity (critical first) then by time opened (most recent first).

---

### Requirement 2: Controller Detail — Sensor and Actuator Monitoring

**User Story:** As a farmer, I want to open a controller and see all its sensors and actuators grouped together, so that I can read values and send commands from one screen.

#### Acceptance Criteria

1. WHEN a farmer opens a Controller Detail page, THE Dashboard SHALL display a Sensor_Card for each sensor channel on that controller showing the channel name, template type, latest reading with unit, a visual progress bar scaled between the channel's configured min and max values, and the time of the last reading.
2. THE Dashboard SHALL group each sensor Sensor_Card with its linked actuator channels so that the farmer can see the actuator controls directly below the sensor they relate to.
3. WHEN a farmer clicks the toggle button on an actuator control, THE Dashboard SHALL send a Manual_Override command via `POST /api/channels/{id}/commands` and display a confirmation message showing the actuator name, the new state, and the override expiry time.
4. WHEN a controller's status is "offline", THE Dashboard SHALL disable all actuator toggle buttons on that controller's detail page.
5. THE Dashboard SHALL refresh the controller snapshot every 3 seconds while the Controller Detail page is open.
6. THE Dashboard SHALL display a history chart for any selected numeric sensor channel, with selectable time ranges of 24 hours, 7 days, and 30 days.
7. THE Dashboard SHALL display a list of recent commands issued to the controller, showing command type, desired state, status, and time issued.
8. THE Dashboard SHALL display a list of open alerts for the controller.

---

### Requirement 3: Irrigation Monitoring and Control

**User Story:** As a farmer, I want to see soil moisture readings and control irrigation valves from the dashboard, so that I can keep my crops watered without walking the field.

#### Acceptance Criteria

1. THE Dashboard SHALL support a `soil_moisture` channel template that reports soil moisture as a percentage (0–100%) with a warning threshold at 40% and a critical threshold at 30%.
2. WHEN a `soil_moisture` channel reading falls below its configured warning threshold, THE Dashboard SHALL open a warning alert for that channel.
3. WHEN a `soil_moisture` channel reading falls below its configured critical threshold, THE Dashboard SHALL open a critical alert for that channel.
4. THE Dashboard SHALL support an `irrigation_valve` channel template that represents an on/off actuator with labels "Open" and "Closed".
5. WHEN a `soil_moisture` channel has a linked `irrigation_valve` channel, THE Dashboard SHALL display the irrigation valve toggle control on the same Sensor_Card as the soil moisture reading.
6. THE Dashboard SHALL provide an "Irrigation Zone" Setup_Preset that bundles one `soil_moisture` channel and one `irrigation_valve` channel with the valve linked to the moisture sensor.

---

### Requirement 4: Weed Detection via Camera Snapshot

**User Story:** As a farmer, I want to see the latest camera image from my field on the dashboard, so that I can visually check for weeds without going out to the field.

#### Acceptance Criteria

1. THE Dashboard SHALL support a `camera_snapshot` channel template that stores the most recent image captured by an ESP32-CAM as either a URL or a base64-encoded JPEG string.
2. WHEN an ESP32-CAM Controller posts a sync request containing a `camera_snapshot` channel reading with an image payload, THE Dashboard SHALL store the snapshot and update the channel's last-sample timestamp.
3. WHEN a farmer opens a Controller Detail page that includes a `camera_snapshot` channel, THE Dashboard SHALL display the latest snapshot image in a dedicated image card showing the image, the channel name, and the time the snapshot was taken.
4. IF a `camera_snapshot` channel has never received an image, THEN THE Dashboard SHALL display a placeholder message "No snapshot yet" in the image card.
5. WHEN a new snapshot is received while the Controller Detail page is open, THE Dashboard SHALL update the displayed image within the next polling cycle (within 3 seconds).
6. THE Dashboard SHALL display the `camera_snapshot` channel as a standalone card, separate from the sensor/actuator grouping logic used for numeric sensors.

---

### Requirement 5: Smart Fish Pond Monitoring and Control

**User Story:** As a farmer, I want to monitor my fish pond's water level and turbidity and control the inlet and flush valves from the dashboard, so that I can keep the pond water clean and at the right level.

#### Acceptance Criteria

1. THE Dashboard SHALL support a `turbidity` channel template that reports water turbidity in NTU (0–100 NTU) with a warning threshold at 55 NTU and a critical threshold at 70 NTU.
2. THE Dashboard SHALL support a `fish_tank_level` channel template that reports fish pond water level as a percentage (0–100%) with a low warning at 35%, a high warning at 95%, a low critical threshold at 20%, and a high critical threshold at 100%.
3. WHEN a `turbidity` reading exceeds its configured warning threshold, THE Dashboard SHALL open a warning alert for that channel.
4. WHEN a `fish_tank_level` reading falls outside its configured low or high critical thresholds, THE Dashboard SHALL open a critical alert for that channel.
5. THE Dashboard SHALL support `flush_valve` and `inlet_valve` channel templates, each representing an on/off actuator with labels "Open" and "Closed".
6. WHEN a `turbidity` channel has linked `flush_valve` and `inlet_valve` channels, THE Dashboard SHALL display both valve controls on the same Sensor_Card as the turbidity reading.
7. THE Dashboard SHALL provide an "Aquaculture Tank" Setup_Preset that bundles `turbidity`, `fish_tank_level`, `flush_valve`, and `inlet_valve` channels with the valves linked to the appropriate sensors.

---

### Requirement 6: Smart Water Supply Monitoring

**User Story:** As a farmer, I want to see my main water tank level and control the pump from the dashboard, so that I always know how much water I have and can refill when needed.

#### Acceptance Criteria

1. THE Dashboard SHALL support a `tank_level` channel template that reports main water tank fill level as a percentage (0–100%) with a warning threshold at 35% and a critical threshold at 20%.
2. WHEN a `tank_level` reading falls below its configured warning threshold, THE Dashboard SHALL open a warning alert for that channel.
3. WHEN a `tank_level` reading falls below its configured critical threshold, THE Dashboard SHALL open a critical alert for that channel.
4. THE Dashboard SHALL support a `pump` channel template that represents an on/off actuator with labels "On" and "Off".
5. WHEN a `tank_level` channel has a linked `pump` channel, THE Dashboard SHALL display the pump toggle control on the same Sensor_Card as the tank level reading.
6. THE Dashboard SHALL provide a "Tank + Pump" Setup_Preset that bundles one `tank_level` channel and one `pump` channel with the pump linked to the tank sensor.

---

### Requirement 7: Pest Control Actuator Channels

**User Story:** As a farmer, I want to see the status of my spray pump and UV zapper on the dashboard and be able to trigger them manually, so that I can respond to pest threats immediately.

#### Acceptance Criteria

1. THE Dashboard SHALL support a `spray_pump` channel template that represents an on/off actuator with labels "Spraying" and "Idle", unit "state", and display type "toggle".
2. THE Dashboard SHALL support a `uv_zapper` channel template that represents an on/off actuator with labels "Active" and "Off", unit "state", and display type "toggle".
3. WHEN a farmer clicks the toggle button on a `spray_pump` or `uv_zapper` channel, THE Dashboard SHALL send a Manual_Override command via `POST /api/channels/{id}/commands` with the desired boolean state and a 2-minute override duration.
4. WHEN a `spray_pump` or `uv_zapper` channel is in the "On" state, THE Dashboard SHALL display the actuator card with a visually distinct active style to make the running state obvious to the farmer.
5. THE Dashboard SHALL display `spray_pump` and `uv_zapper` channels as standalone actuator cards on the Controller Detail page when they are not linked to a sensor channel.
6. THE Dashboard SHALL include `spray_pump` and `uv_zapper` channel templates in the channel template selector on the Settings page so farmers can add them individually to any controller.

---

### Requirement 8: Pest Control Schedule

**User Story:** As a farmer, I want to set a spray schedule and UV zapper dusk/dawn window on the dashboard, so that pest control runs automatically without me having to trigger it manually every time.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Pest Control Schedule configuration panel on the Controller Detail page for any controller that has at least one `spray_pump` or `uv_zapper` channel.
2. THE Pest_Control_Schedule SHALL allow the farmer to define one or more spray time slots, each consisting of a start time (HH:MM, 24-hour format) and a duration in minutes (1–120 minutes).
3. THE Pest_Control_Schedule SHALL allow the farmer to configure the UV zapper activation window as a start time and an end time (HH:MM, 24-hour format), representing the nightly active period.
4. WHEN a farmer saves a Pest_Control_Schedule, THE Dashboard SHALL persist the schedule and make it available to the ESP32 controller on its next sync response.
5. WHEN an ESP32 controller sends a sync request, THE Dashboard SHALL include the current Pest_Control_Schedule for that controller in the sync response so the device can execute scheduled activations autonomously.
6. IF a Pest_Control_Schedule has not been configured for a controller, THEN THE Dashboard SHALL return an empty schedule in the sync response, and THE Dashboard SHALL display a "No schedule set" message in the schedule panel.
7. WHEN a farmer updates a Pest_Control_Schedule, THE Dashboard SHALL replace the previous schedule entirely with the new one.

---

### Requirement 9: Pest Control Activity Log

**User Story:** As a farmer, I want to see a log of recent spray pump and UV zapper activations on the dashboard, so that I can confirm that pest control ran as scheduled and review what happened.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Pest_Control_Log panel on the Controller Detail page for any controller that has at least one `spray_pump` or `uv_zapper` channel.
2. THE Pest_Control_Log SHALL show the 20 most recent activation events for `spray_pump` and `uv_zapper` channels on that controller, ordered by time (most recent first).
3. EACH entry in the Pest_Control_Log SHALL show the channel name (e.g. "Spray Pump"), the activation type ("manual" or "scheduled"), the state change (On or Off), and the timestamp.
4. WHEN the Controller Detail page is open, THE Dashboard SHALL refresh the Pest_Control_Log every 10 seconds.
5. IF no activation events have been recorded for a controller's pest control channels, THEN THE Dashboard SHALL display a "No activity yet" message in the Pest_Control_Log panel.

---

### Requirement 10: Pest Control Setup Preset

**User Story:** As a farmer, I want to set up a pest control controller in one click, so that I don't have to add each channel manually.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a "Pest Control" Setup_Preset that bundles one `spray_pump` channel and one `uv_zapper` channel.
2. WHEN the "Pest Control" Setup_Preset is applied to a controller, THE Dashboard SHALL create both channels with default names ("Spray Pump" and "UV Zapper"), unique channel keys, and the default template configuration for each.
3. THE Dashboard SHALL update the "Full GanSystems Starter" Setup_Preset to include the `spray_pump` and `uv_zapper` channels from the Pest Control preset, so that a full-farm demo controller includes pest control out of the box.
4. THE Dashboard SHALL display the "Pest Control" preset as a selectable option in both the starter bundle dropdown when creating a new controller and the "Bundle existing controller" panel on the Settings page.

---

### Requirement 11: Manual Control of All Actuators

**User Story:** As a farmer, I want to manually turn any actuator on or off from the dashboard at any time, so that I can respond to situations on the farm immediately without waiting for automation.

#### Acceptance Criteria

1. THE Dashboard SHALL display a toggle button for every actuator channel (pump, irrigation_valve, flush_valve, inlet_valve, spray_pump, uv_zapper) on the Controller Detail page.
2. WHEN a farmer clicks a toggle button, THE Dashboard SHALL immediately send a Manual_Override command to the ESP32 via `POST /api/channels/{id}/commands` with the desired on/off state.
3. THE Manual_Override command SHALL include an override duration of 2 minutes, after which the ESP32 resumes its normal automated behaviour.
4. WHEN a manual command is successfully queued, THE Dashboard SHALL display a confirmation message showing the actuator name, the new state (e.g. "Irrigation Valve set to Open"), and when the override expires.
5. WHEN a controller's status is "offline", THE Dashboard SHALL disable all actuator toggle buttons and display a message "Controller offline — manual control unavailable" so the farmer knows commands cannot be delivered.
6. WHEN a controller's status is "stale", THE Dashboard SHALL still allow manual commands to be sent but SHALL display a warning "Controller is stale — command delivery may be delayed".
7. THE Dashboard SHALL display the current state of every actuator (on or off) in real time, updating within 3 seconds of the ESP32 acknowledging a command.
8. THE Dashboard SHALL show a "pending" indicator on an actuator toggle button while a command has been sent but not yet acknowledged by the ESP32.
9. WHEN the ESP32 acknowledges a manual command, THE Dashboard SHALL remove the pending indicator and update the actuator's displayed state to match the acknowledged state.
10. THE Dashboard SHALL log every manual command in the Recent Command Log on the Controller Detail page, showing the actuator name, the commanded state, the status (pending/acknowledged/failed), and the timestamp.

---

### Requirement 12: ESP32 Device Sync Protocol

**User Story:** As a developer integrating an ESP32, I want a clear and consistent sync API, so that I can write firmware that reliably reports sensor data and receives commands.

#### Acceptance Criteria

1. WHEN an ESP32 controller sends a `POST /api/device/sync` request with valid `x-device-id` and `x-device-key` headers and a JSON body containing a `readings` array, THE Dashboard SHALL process each reading, update the corresponding channel's latest value and timestamp, and return a 200 response.
2. THE sync response SHALL include a `commands` array containing all pending commands for the controller's channels, ordered by creation time (oldest first), so the device can execute them in order.
3. THE sync response SHALL include a `pestControlSchedule` field containing the current Pest_Control_Schedule for the controller (or an empty schedule object if none is configured).
4. WHEN a reading in the sync request contains a `booleanState` field, THE Dashboard SHALL update the channel's `latestBooleanState` and record a telemetry sample with that boolean value.
5. WHEN a reading in the sync request contains a `payload` field with an `imageUrl` or `imageBase64` key, THE Dashboard SHALL store the image data on the corresponding `camera_snapshot` channel.
6. IF an ESP32 sends a sync request with an unrecognised `x-device-id` or an invalid `x-device-key`, THEN THE Dashboard SHALL return a 401 response and SHALL NOT process any readings from that request.
7. WHEN an ESP32 sends an acknowledgement for a command in the `acknowledgements` array of a sync request, THE Dashboard SHALL update that command's status to "acknowledged" and record the device message and execution timestamp.

---

### Requirement 13: Alerts and Threshold Monitoring

**User Story:** As a farmer, I want the dashboard to automatically raise alerts when sensor readings go out of range, so that I don't have to watch every number myself.

#### Acceptance Criteria

1. WHEN a sensor channel reading exceeds the channel's configured `thresholdHigh` or falls below the channel's configured `thresholdLow`, THE Dashboard SHALL create a critical alert for that channel if no critical alert is already open for it.
2. WHEN a sensor channel reading exceeds the channel's configured `warningHigh` or falls below the channel's configured `warningLow` (but does not cross a critical threshold), THE Dashboard SHALL create a warning alert for that channel if no warning alert is already open for it.
3. WHEN a sensor channel reading returns to within the safe range (between warning thresholds), THE Dashboard SHALL automatically resolve any open warning or critical alert for that channel.
4. WHEN a controller's status transitions to "offline", THE Dashboard SHALL create a critical alert for that controller if no offline alert is already open for it.
5. WHEN an offline controller sends a sync request and its status returns to "online", THE Dashboard SHALL automatically resolve the offline alert for that controller.
6. THE Dashboard SHALL display all open alerts on the main Dashboard overview page and on the relevant Controller Detail page.
