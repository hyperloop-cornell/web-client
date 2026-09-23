import type { PortInfo } from '@/types';

/**
 * Fixtures for the mock hub backend (see mockBackend.ts).
 *
 * Each port streams one line of fake serial output per tick. The line formats are chosen so
 * that the sensor auto-detection in src/config/sensor-mappings.json picks the intended sensor
 * (detection is first-match in file order, so e.g. a "TEMP: x PRESS: y" line would be
 * detected as DS18B20 rather than BMP180 and is deliberately not used here).
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
  ports: MockPortDef[];
}

/** Approximate serial throughput per open connection; keeps bytes_read moving between polls. */
export const BYTES_PER_SECOND = 60;

/** How often each subscribed port emits a telemetry line. */
export const TELEMETRY_INTERVAL_MS = 500;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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

export const MOCK_HUBS: MockHubDef[] = [
  {
    hubId: 'hub-pit-01',
    version: '1.4.2',
    connected: true,
    connectedAgoMs: 3 * HOUR + 12 * MINUTE,
    lastSeenAgoMs: 0,
    ports: [
      {
        info: {
          port_id: 'usb-uno-a1f3',
          port: '/dev/ttyACM0',
          description: 'Arduino Uno',
          manufacturer: 'Arduino (www.arduino.cc)',
          serial_number: '85735313236351E0B0A1',
          vendor_id: '2341',
          product_id: '0043',
        },
        baudRate: 9600,
        generateLine: dht22,
      },
      {
        info: {
          port_id: 'usb-mega-b2c4',
          port: '/dev/ttyACM1',
          description: 'Arduino Mega 2560',
          manufacturer: 'Arduino (www.arduino.cc)',
          serial_number: '75833353935351A0C1B2',
          vendor_id: '2341',
          product_id: '0042',
        },
        baudRate: 115200,
        generateLine: mpu6050,
      },
      {
        info: {
          port_id: 'usb-nano-c3d5',
          port: '/dev/ttyUSB0',
          description: 'USB Serial (CH340)',
          manufacturer: 'QinHeng Electronics',
          vendor_id: '1a86',
          product_id: '7523',
        },
        baudRate: 9600,
        generateLine: voltage,
      },
    ],
  },
  {
    hubId: 'hub-lab-02',
    version: '1.4.2',
    connected: true,
    connectedAgoMs: 25 * MINUTE,
    lastSeenAgoMs: 0,
    ports: [
      {
        info: {
          port_id: 'usb-uno-d4e6',
          port: '/dev/ttyACM0',
          description: 'Arduino Uno',
          manufacturer: 'Arduino (www.arduino.cc)',
          serial_number: '85735313236351F1C2B3',
          vendor_id: '2341',
          product_id: '0043',
        },
        baudRate: 9600,
        generateLine: bme280,
      },
      {
        info: {
          port_id: 'usb-leonardo-f6a8',
          port: '/dev/ttyACM1',
          description: 'Arduino Leonardo',
          manufacturer: 'Arduino LLC',
          serial_number: '7&2A1B3C4D&0&2',
          vendor_id: '2341',
          product_id: '8036',
        },
        baudRate: 9600,
        generateLine: current,
      },
      {
        info: {
          port_id: 'usb-nano-e5f7',
          port: '/dev/ttyUSB0',
          description: 'USB Serial (CH340)',
          manufacturer: 'QinHeng Electronics',
          vendor_id: '1a86',
          product_id: '7523',
        },
        baudRate: 9600,
        generateLine: hcsr04,
      },
    ],
  },
  {
    // Shows the "Disconnected" state on the dashboard; a disconnected hub reports no ports.
    hubId: 'hub-track-03',
    version: '1.3.9',
    connected: false,
    connectedAgoMs: 0,
    lastSeenAgoMs: 2 * HOUR + 5 * MINUTE,
    ports: [],
  },
];
