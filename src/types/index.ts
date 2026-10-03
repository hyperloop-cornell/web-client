import type { components } from './api.gen';

// Wire types come from cloud-services' contract (src/types/api.gen.ts, regenerated with
// `npm run gen:types`). Do not redefine them here: the generated file is what keeps the GUI,
// the mock backend and the cloud in agreement.
type Schemas = components['schemas'];

// Authentication types
export interface LoginCredentials {
  username: string; // NetID
  password: string; // team password
}

export type AuthToken = Schemas['TokenResponse'];

export type UserRole = 'operator' | 'viewer';

export interface User {
  username: string;
  email?: string | null;
  full_name?: string | null;
  role?: UserRole | string | null;
}

// Hub types
export type HubInfo = Schemas['HubInfo'];
export type HubProfile = Schemas['HubProfile'];
export type BoardProfileInfo = Schemas['BoardProfileInfo'];

// Port and Connection types
export type PortInfo = Schemas['PortInfo'];
export type PortListResponse = Schemas['PortListResponse'];
export type ConnectionInfo = Schemas['ConnectionInfo'];
export type ConnectionListResponse = Schemas['ConnectionListResponse'];

// Telemetry types
export type TelemetryEntry = Schemas['TelemetryEntry'];
export type TelemetryListResponse = Schemas['TelemetryListResponse'];

// Commands
export type TaskStatusResponse = Schemas['TaskStatusResponse'];
export type FlashFirmwareRequest = Schemas['FlashFirmwareRequest'];
export type ArtifactFormat = NonNullable<FlashFirmwareRequest['artifactFormat']>;

// WebSocket messages (cloud -> browser)
export type ConnectedMessage = Schemas['ConnectedMessage'];
export type PingMessage = Schemas['PingMessage'];
export type TelemetryMessage = Schemas['TelemetryStreamMessage'];
export type HealthMessage = Schemas['HealthBroadcast'];
export type DeviceEventMessage = Schemas['DeviceEventBroadcast'];
export type TaskStatusMessage = Schemas['TaskStatusBroadcast'];
export type SubscriptionStatusMessage = Schemas['SubscriptionStatusMessage'];
export type HubStatusMessage = Schemas['HubStatusBroadcast'];

export type WebSocketMessage =
  | ConnectedMessage
  | PingMessage
  | TelemetryMessage
  | HealthMessage
  | DeviceEventMessage
  | TaskStatusMessage
  | SubscriptionStatusMessage
  | HubStatusMessage;

// WebSocket messages (browser -> cloud)
export type SubscribeMessage = Schemas['SubscribeMessage'];
export type UnsubscribeMessage = Schemas['UnsubscribeMessage'];
export type PongMessage = Schemas['PongMessage'];
export type DeviceSubscription = Schemas['DeviceSubscription'];

export interface ActiveSubscription extends DeviceSubscription {
  subscribedAt: string;
  /** Set once the cloud reports the subscription active (subscription_status) or data arrives. */
  confirmed?: boolean;
}

// Sensor types
export interface SensorField {
  name: string;
  unit: string;
  color: string;
  captureGroup: number;
}

export interface SensorMapping {
  id: string;
  name: string;
  description: string;
  format: 'key-value' | 'csv' | 'json';
  pattern: string;
  fields: SensorField[];
}

export interface SensorMappings {
  sensors: SensorMapping[];
}

// Parsed data types
export interface ParsedSensorData {
  sensorId: string;
  sensorName: string;
  timestamp: Date;
  fields: {
    name: string;
    value: number;
    unit: string;
    color: string;
  }[];
}

export interface DecodedTelemetry {
  raw: Uint8Array;
  text: string;
  lines: string[];
}

// Chart data types
export interface ChartDataPoint {
  timestamp: number;
  value: number;
}

export interface FieldChartData {
  fieldName: string;
  unit: string;
  color: string;
  data: ChartDataPoint[];
}

export interface DeviceChartData {
  deviceId: string;
  hubId: string;
  portId: string;
  sensorName: string;
  fields: FieldChartData[];
}

/** A chart the user built by shift-dropping one chart onto another. */
export interface MergedChart {
  id: string;
  keys: string[]; // hubId:portId of each source
}

// Time window types
export type TimeWindow = '5m' | '15m' | '30m' | '1h' | 'custom';

export interface TimeWindowConfig {
  value: TimeWindow;
  label: string;
  milliseconds: number;
}

export interface CustomTimeRange {
  start: Date;
  end: Date;
}

// Task tracking in the GUI (built from TaskStatusResponse + task_status messages)
export type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  task_id: string;
  command_type: string;
  status: TaskState;
  priority: number;
  port_id: string;
  hub_id: string;
  result?: unknown;
  error?: string | null;
  /** 0-100 when the hub reports it (task_status.progress); null while unknown. */
  progress?: number | null;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export function toTaskState(status: string): TaskState {
  return (['pending', 'running', 'completed', 'failed', 'cancelled'] as const).includes(status as TaskState)
    ? (status as TaskState)
    : 'failed';
}

// Live hub state from health messages
export interface HubHealth {
  timestamp: string;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  disk_percent?: number | null;
  mode?: string | null;
  uplink?: ({ active?: string | null; stale?: boolean } & Record<string, unknown>) | null;
}
