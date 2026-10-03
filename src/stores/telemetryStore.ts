import { create } from 'zustand';
import type { TelemetryMessage, DeviceChartData, FieldChartData, MergedChart, SensorMapping } from '@/types';
import { parseTelemetryData } from '@/services/sensorParser';
import { deviceKey } from '@/lib/format';

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Terminal history kept per device. */
const MAX_LINES = 500;

export interface TerminalLine {
  ts: number;
  text: string;
}

/** A line the user sent from the terminal; its delivery state comes from the task in hubStore. */
export interface SentLine {
  ts: number;
  text: string;
  taskId: string | null;
  error?: string;
}

interface DeviceTelemetryState {
  lines: TerminalLine[];
  sensorMapping?: SensorMapping;
  chartData: DeviceChartData;
  lastUpdate: number;
}

/** Chart order and merges on the Telemetry page; kept here so they survive navigation. */
interface ChartLayout {
  order: string[];
  merged: MergedChart[];
}

interface TelemetryState {
  // Keyed by hubId:portId
  devices: Map<string, DeviceTelemetryState>;
  detectedSensors: Map<string, string>;
  sent: Record<string, SentLine[]>;
  layout: ChartLayout;

  processTelemetry: (message: TelemetryMessage) => void;
  clearDevice: (hubId: string, portId: string) => void;
  recordSent: (key: string, line: SentLine) => void;
  setLayout: (layout: ChartLayout) => void;
  /** Drop an unsubscribed device from chart merges (a merge needs two sources). */
  removeFromLayout: (key: string) => void;
  reset: () => void;
}

const emptyLayout = (): ChartLayout => ({ order: [], merged: [] });

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  devices: new Map(),
  detectedSensors: new Map(),
  sent: {},
  layout: emptyLayout(),

  processTelemetry: (message: TelemetryMessage) => {
    const key = deviceKey(message.hubId, message.portId);
    const state = get();
    const existing = state.devices.get(key);

    const { decoded, parsed, detectedSensor } = parseTelemetryData(message.data, existing?.sensorMapping);
    const timestamp = new Date(message.timestamp).getTime();
    const sensorMapping = detectedSensor || existing?.sensorMapping;

    const newLines = decoded.lines.map((text) => ({ ts: timestamp, text }));
    const lines = [...(existing?.lines ?? []), ...newLines];
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);

    // Rebuild the field arrays instead of mutating them so consumers can rely on identity
    let fields: FieldChartData[] = existing?.chartData.fields ?? [];
    if (parsed.length > 0 && sensorMapping) {
      const byName = new Map(fields.map((f) => [f.fieldName, f]));
      const cutoff = Date.now() - ONE_HOUR_MS;
      const added = new Map<string, { unit: string; color: string; points: { timestamp: number; value: number }[] }>();
      for (const sample of parsed) {
        for (const field of sample.fields) {
          const entry = added.get(field.name) ?? { unit: field.unit, color: field.color, points: [] };
          entry.points.push({ timestamp, value: field.value });
          added.set(field.name, entry);
        }
      }
      for (const [name, entry] of added) {
        const prev = byName.get(name);
        const kept = prev ? prev.data.filter((p) => p.timestamp >= cutoff) : [];
        byName.set(name, {
          fieldName: name,
          unit: prev?.unit ?? entry.unit,
          color: prev?.color ?? entry.color,
          data: [...kept, ...entry.points],
        });
      }
      fields = Array.from(byName.values());
    }

    const deviceState: DeviceTelemetryState = {
      lines,
      sensorMapping,
      chartData: {
        deviceId: key,
        hubId: message.hubId,
        portId: message.portId,
        sensorName: sensorMapping?.name || existing?.chartData.sensorName || 'Unknown',
        fields,
      },
      lastUpdate: Date.now(),
    };

    const devices = new Map(state.devices);
    devices.set(key, deviceState);

    if (detectedSensor && state.detectedSensors.get(key) !== detectedSensor.name) {
      const detectedSensors = new Map(state.detectedSensors);
      detectedSensors.set(key, detectedSensor.name);
      set({ devices, detectedSensors });
    } else {
      set({ devices });
    }
  },

  clearDevice: (hubId: string, portId: string) => {
    const devices = new Map(get().devices);
    devices.delete(deviceKey(hubId, portId));
    set({ devices });
  },

  recordSent: (key, line) => {
    set((state) => ({ sent: { ...state.sent, [key]: [...(state.sent[key] ?? []), line].slice(-100) } }));
  },

  setLayout: (layout) => set({ layout }),

  removeFromLayout: (key) => {
    set((state) => ({
      layout: {
        order: state.layout.order.filter((id) => id !== key),
        merged: state.layout.merged
          .map((m) => ({ ...m, keys: m.keys.filter((k) => k !== key) }))
          .filter((m) => m.keys.length > 1),
      },
    }));
  },

  reset: () => set({ devices: new Map(), detectedSensors: new Map(), sent: {}, layout: emptyLayout() }),
}));
