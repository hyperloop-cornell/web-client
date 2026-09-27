import type { HubProfile, PortInfo } from '@/types';
import { findBoard } from '@/config/boards';

/**
 * Fixtures for the in-browser mock backend (see ./index.ts).
 *
 * Each port streams one line of fake serial output per tick. The line formats are chosen so
 * that the sensor auto-detection in src/config/sensor-mappings.json picks the intended sensor
 * (detection is first-match in file order, so e.g. a "TEMP: x PRESS: y" line would be
 * detected as DS18B20 rather than BMP180 and is deliberately not used here). rpi-hub-server's
 * simulated boards (src/sim/generators.py) emit the same formats.
 */

/** Produces one line of serial output. `t` is seconds since the mock backend started. */
export type LineGenerator = (t: number) => string;

export interface MockPortDef {
  info: PortInfo;
  baudRate: number;
  generateLine: LineGenerator;
}

export interface MockHubDef {
  hubId: string;
  version: string;
  connected: boolean;
  /** How long ago the hub connected, relative to mock startup. Only meaningful if connected. */
  connectedAgoMs: number;
  /** How long ago the hub was last seen, relative to mock startup. Only meaningful if disconnected. */
  lastSeenAgoMs: number;
  capabilities: string[];
  profile: HubProfile | null;
  /** Reported in health messages, like a hub running the uplink manager. */
  uplink: 'wifi' | 'cellular' | null;
  ports: MockPortDef[];
}

/** Approximate serial throughput per open connection; keeps bytes_read moving between polls. */
export const BYTES_PER_SECOND = 60;

/** How often each subscribed port emits a telemetry line. */
export const TELEMETRY_INTERVAL_MS = 500;

/** Same cadence as rpi-hub-server's default health.report_interval. */
export const HEALTH_INTERVAL_MS = 30000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Capabilities advertised by current hubs (see rpi-hub-server runtime.capabilities()). */
const CURRENT_HUB_CAPABILITIES = ['bench', 'flash:ino', 'flash:hex', 'flash:bin', 'flash:elf', 'device_snapshot'];

/** What the cloud assumes for hubs that predate capabilities in the handshake. */
const LEGACY_HUB_CAPABILITIES = ['bench', 'flash:ino', 'flash:hex'];

const wave = (t: number, base: number, amplitude: number, periodSeconds: number, phase = 0): number =>
  base + amplitude * Math.sin((2 * Math.PI * t) / periodSeconds + phase);

const jitter = (amplitude: number): number => (Math.random() * 2 - 1) * amplitude;

const fmt = (value: number, digits = 1): string => value.toFixed(digits);

const dht22: LineGenerator = (t) =>
  `TEMP: ${fmt(wave(t, 22.5, 1.5, 90) + jitter(0.15))} HUMID: ${fmt(wave(t, 46, 4, 120, 1) + jitter(0.4))}`;

const mpu6050: LineGenerator = (t) =>
  [
    `AX: ${fmt(jitter(0.05), 2)}`,
    `AY: ${fmt(jitter(0.05), 2)}`,
    `AZ: ${fmt(0.98 + jitter(0.03), 2)}`,
    `GX: ${fmt(wave(t, 0, 15, 6) + jitter(1))}`,
    `GY: ${fmt(wave(t, 0, 10, 9, 2) + jitter(1))}`,
    `GZ: ${fmt(jitter(2))}`,
  ].join(' ');

const voltage: LineGenerator = (t) => `VOLT: ${fmt(wave(t, 12.3, 0.25, 40) + jitter(0.03), 2)}`;

const bme280: LineGenerator = (t) =>
  [
    fmt(wave(t, 21.8, 1.2, 100) + jitter(0.1)),
    fmt(wave(t, 52, 6, 150, 0.5) + jitter(0.3)),
    fmt(wave(t, 1013.2, 2.5, 200, 1.5) + jitter(0.1)),
  ].join(',');

const hcsr04: LineGenerator = (t) => `DIST: ${fmt(wave(t, 60, 25, 20) + jitter(0.5))}`;

const current: LineGenerator = (t) => `CURRENT: ${fmt(wave(t, 3.2, 0.8, 30) + jitter(0.05), 2)}`;

function port(
  portId: string,
  path: string,
  description: string,
  vendorId: string,
  productId: string,
  boardId: string | null,
  extra: Partial<PortInfo> = {}
): PortInfo {
  return {
    port_id: portId,
    port: path,
    description,
    vendor_id: vendorId,
    product_id: productId,
    board_profile: findBoard(boardId) ?? null,
    ...extra,
  };
}

export const MOCK_HUBS: MockHubDef[] = [
  {
    hubId: 'lab-hub-01',
    version: '1.1.0',
    connected: true,
    connectedAgoMs: 3 * HOUR + 12 * MINUTE,
    lastSeenAgoMs: 0,
    capabilities: CURRENT_HUB_CAPABILITIES,
    profile: { name: 'lab-hub', mode: 'bench', uplink: null },
    uplink: null,
    ports: [
      {
        info: port('port_a1f3c0de', '/dev/ttyACM0', 'Arduino Uno', '2341', '0043', 'uno_r3', {
          manufacturer: 'Arduino (www.arduino.cc)',
          serial_number: '85735313236351E0B0A1',
        }),
        baudRate: 9600,
        generateLine: dht22,
      },
      {
        info: port('port_b2c4d1e2', '/dev/ttyACM1', 'UNO R4 Minima', '2341', '0069', 'uno_r4_minima', {
          manufacturer: 'Arduino',
          serial_number: '3E3C2F4D0B1A',
        }),
        baudRate: 115200,
        generateLine: current,
      },
      {
        info: port('port_c3d5e2f3', '/dev/ttyACM2', 'STM32 STLink', '0483', '374b', 'disco_f407vg', {
          manufacturer: 'STMicroelectronics',
          serial_number: '066DFF485457725187092235',
        }),
        baudRate: 115200,
        generateLine: bme280,
      },
    ],
  },
  {
    hubId: 'cellular-hub',
    version: '1.1.0',
    connected: true,
    connectedAgoMs: 25 * MINUTE,
    lastSeenAgoMs: 0,
    capabilities: CURRENT_HUB_CAPABILITIES,
    profile: { name: 'cellular-hub', mode: 'bench', uplink: 'cellular' },
    uplink: 'cellular',
    ports: [
      {
        info: port('port_d4e6f3a4', '/dev/ttyACM0', 'Arduino Mega 2560', '2341', '0042', 'mega2560', {
          manufacturer: 'Arduino (www.arduino.cc)',
          serial_number: '75833353935351A0C1B2',
        }),
        baudRate: 115200,
        generateLine: mpu6050,
      },
      {
        info: port('port_e5f7a4b5', '/dev/ttyUSB0', 'USB Serial (CH340)', '1a86', '7523', 'nano_ch340', {
          manufacturer: 'QinHeng Electronics',
        }),
        baudRate: 9600,
        generateLine: hcsr04,
      },
    ],
  },
  {
    // A hub still running the previous rpi-hub-server: no capabilities/profile in its handshake
    hubId: 'rpi-bridge-01',
    version: '1.0.0',
    connected: true,
    connectedAgoMs: 2 * HOUR,
    lastSeenAgoMs: 0,
    capabilities: LEGACY_HUB_CAPABILITIES,
    profile: null,
    uplink: null,
    ports: [
      {
        info: port('port_f6a8b5c6', '/dev/ttyUSB0', 'USB Serial (CH340)', '1a86', '7523', null, {
          manufacturer: 'QinHeng Electronics',
        }),
        baudRate: 9600,
        generateLine: voltage,
      },
    ],
  },
  {
    // Configured in the cloud but offline: the dashboard shows it as disconnected with no ports
    hubId: 'rpi-bridge-02',
    version: '1.1.0',
    connected: false,
    connectedAgoMs: 0,
    lastSeenAgoMs: 2 * HOUR + 5 * MINUTE,
    capabilities: CURRENT_HUB_CAPABILITIES,
    profile: { name: 'lab-hub', mode: 'bench', uplink: null },
    uplink: null,
    ports: [],
  },
];
