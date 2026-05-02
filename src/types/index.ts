// Authentication types
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
}

export interface User {
  username: string;
  role?: string;  // "admin" or "viewer"
}

// Hub types
export interface HubInfo {
  hubId: string;
  connected: boolean;
  connectedAt?: string;
  lastSeen?: string;
  version?: string;
}

// Port and Connection types
export interface PortInfo {
  port_id: string;
  port: string;
  description?: string;
  manufacturer?: string;
  serial_number?: string;
  vendor_id?: string;
  product_id?: string;
}

export interface ConnectionInfo {
  port_id: string;
  status: string;
  baud_rate: number;
  session_id: string;
  bytes_read: number;
  bytes_written: number;
  connected_at?: string;
}

// Telemetry types
export interface TelemetryEntry {
  timestamp: string;
  portId: string;
  sessionId: string;
  data: string; // base64 encoded
  dataSizeBytes: number;
}

export interface TelemetryMessage {
  type: 'telemetry_stream';
  hubId: string;
  portId: string;
  sessionId: string;
  timestamp: string;
  data: string; // base64 encoded
  dataSizeBytes?: number;
}

// WebSocket message types
export interface SubscribeMessage {
  type: 'subscribe';
  subscriptions: DeviceSubscription[];
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  subscriptions: DeviceSubscription[];
}

export interface SubscriptionStatusMessage {
  type: 'subscription_status';
  subscriptions: {
    hubId: string;
    portId: string;
    status: 'active' | 'inactive';
  }[];
}

export interface HealthMessage {
  type: 'health';
  hubId: string;
  timestamp: string;
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
}

export interface DeviceEventMessage {
  type: 'device_event';
  hubId: string;
  timestamp: string;
  event: 'connected' | 'disconnected';
  portId: string;
}

export interface TaskStatusMessage {
  type: 'task_status';
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  timestamp: string;
}

export interface PingMessage {
  type: 'ping';
  timestamp: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: string;
}

export type WebSocketMessage =
  | TelemetryMessage
  | HealthMessage
  | DeviceEventMessage
  | SubscriptionStatusMessage
  | TaskStatusMessage
  | PingMessage
  | PongMessage;

// Subscription types
export interface DeviceSubscription {
  hubId: string;
  portId: string;
}

export interface ActiveSubscription extends DeviceSubscription {
  sensorType?: string;
  sensorName?: string;
  subscribedAt: string;
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

export interface MergedChartData {
  id: string;
  sources: DeviceChartData[];
  isMerged: true;
}

export type ChartData = DeviceChartData | MergedChartData;

export function isMergedChart(data: ChartData): data is MergedChartData {
  return 'isMerged' in data && data.isMerged === true;
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

// Task types
export interface TaskStatusResponse {
  task_id: string;
  command_type: string;
  status: string;
  priority: number;
  result?: string;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface Task {
  task_id: string;
  command_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  port_id: string;
  hub_id: string;
  result?: unknown;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}
