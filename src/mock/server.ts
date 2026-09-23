import type {
  ArtifactFormat,
  ConnectionInfo,
  HealthMessage,
  HubInfo,
  PortInfo,
  TaskStatusResponse,
  TelemetryEntry,
  WebSocketMessage,
} from '@/types';
import { BYTES_PER_SECOND, MOCK_HUBS, type MockHubDef, type MockPortDef } from './fixtures';

/**
 * In-memory stand-in for cloud-services plus the hubs behind it.
 *
 * Commands play out the way a real hub reports them: the HTTP call returns a pending task, then
 * task_status messages follow over the WebSocket (pending -> running -> completed/failed), with
 * the same failure rules the hub applies (closed port, unsupported firmware format, missing FQBN).
 */

export type CommandType = 'serial_write' | 'flash' | 'restart' | 'close_connection';

const COMMAND_DURATION_MS: Record<CommandType, number> = {
  serial_write: 300,
  flash: 4000,
  restart: 1500,
  close_connection: 500,
};

// Delay before a task reports "running", so the client has registered it from the HTTP response.
const TASK_START_DELAY_MS = 400;

interface ConnectionState {
  portId: string;
  sessionId: string;
  openedAt: number;
  bytesWritten: number;
}

interface HubState {
  def: MockHubDef;
  connectedAt: number | null;
  lastSeenAt: number;
  connections: Map<string, ConnectionState>;
}

export interface Listener {
  deliver(message: WebSocketMessage): void;
  dropSubscription(hubId: string, portId: string): void;
}

function uuid(): string {
  // crypto.randomUUID is unavailable on insecure origins (the dev server binds 0.0.0.0).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function newSessionId(): string {
  return `session-${uuid().replace(/-/g, '').slice(0, 12)}`;
}

function iso(ms: number = Date.now()): string {
  return new Date(ms).toISOString();
}

/** Mirrors rpi-hub-server src/bench/flashing/formats.py detect_format(). */
function detectFormat(firmwareBase64: string, declared: ArtifactFormat | null | undefined): ArtifactFormat {
  let text: string;
  try {
    text = atob(firmwareBase64);
  } catch {
    throw new Error('Invalid firmware data encoding');
  }
  if (declared) return declared;
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => /^:[0-9A-Fa-f]{10,}$/.test(line.trim()))) return 'hex';
  if (/void\s+setup|void\s+loop|serial\.|pinmode/i.test(text) || /[{};]/.test(text)) return 'ino';
  throw new Error('Invalid firmware format. Must be Intel HEX (.hex) or Arduino source (.ino)');
}

export class MockHubServer {
  readonly startedAt = Date.now();
  private readonly hubs = new Map<string, HubState>();
  private readonly listeners = new Set<Listener>();

  constructor() {
    for (const def of MOCK_HUBS) {
      const connections = new Map<string, ConnectionState>();
      if (def.connected) {
        for (const port of def.ports) {
          connections.set(port.info.port_id, this.openConnection(port.info.port_id));
        }
      }
      this.hubs.set(def.hubId, {
        def,
        connectedAt: def.connected ? this.startedAt - def.connectedAgoMs : null,
        lastSeenAt: this.startedAt - def.lastSeenAgoMs,
        connections,
      });
    }
  }

  private openConnection(portId: string): ConnectionState {
    return { portId, sessionId: newSessionId(), openedAt: Date.now(), bytesWritten: 0 };
  }

  private findPort(hub: HubState, portId: string): MockPortDef | undefined {
    return hub.def.ports.find((p) => p.info.port_id === portId);
  }

  elapsedSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  // --- REST-facing reads (shapes match cloud-services responses) ---

  getHub(hubId: string): HubState | undefined {
    return this.hubs.get(hubId);
  }

  listHubs(): HubInfo[] {
    return Array.from(this.hubs.values()).map((hub) => this.toHubInfo(hub));
  }

  toHubInfo(hub: HubState): HubInfo {
    const connected = hub.def.connected;
    return {
      hubId: hub.def.hubId,
      connected,
      connectedAt: connected && hub.connectedAt ? iso(hub.connectedAt) : null,
      lastSeen: iso(connected ? Date.now() : hub.lastSeenAt),
      version: hub.def.version,
      capabilities: hub.def.capabilities,
      profile: hub.def.profile,
    };
  }

  listPorts(hub: HubState): PortInfo[] {
    return hub.def.connected ? hub.def.ports.map((p) => p.info) : [];
  }

  listConnections(hub: HubState): ConnectionInfo[] {
    if (!hub.def.connected) return [];
    const now = Date.now();
    const result: ConnectionInfo[] = [];

    for (const conn of hub.connections.values()) {
      const port = this.findPort(hub, conn.portId);
      if (!port) continue;
      result.push({
        port_id: conn.portId,
        status: 'connected',
        baud_rate: port.baudRate,
        session_id: conn.sessionId,
        // Grows continuously so DeviceManager's inactivity check never trips on mock ports.
        bytes_read: Math.floor(((now - conn.openedAt) / 1000) * BYTES_PER_SECOND),
        bytes_written: conn.bytesWritten,
        connected_at: iso(conn.openedAt),
      });
    }
    return result;
  }

  /** Synthesizes recent history: `limit` entries per open connection, one per second, oldest first. */
  history(hub: HubState, limit: number): TelemetryEntry[] {
    const now = Date.now();
    const entries: TelemetryEntry[] = [];

    for (const conn of hub.connections.values()) {
      const port = this.findPort(hub, conn.portId);
      if (!port) continue;
      for (let i = limit - 1; i >= 0; i--) {
        const at = now - i * 1000;
        const line = `${port.generateLine((at - this.startedAt) / 1000)}\n`;
        entries.push({
          timestamp: iso(at),
          portId: conn.portId,
          sessionId: conn.sessionId,
          data: btoa(line),
          dataSizeBytes: line.length,
        });
      }
    }
    return entries;
  }

  // --- Listeners (mock WebSockets) ---

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  broadcast(message: WebSocketMessage): void {
    this.listeners.forEach((listener) => listener.deliver(message));
  }

  /** One fresh line of output for a port, or null if the port has no open connection. */
  sample(hubId: string, portId: string): { line: string; sessionId: string } | null {
    const hub = this.hubs.get(hubId);
    const conn = hub?.connections.get(portId);
    const port = hub && this.findPort(hub, portId);
    if (!hub || !hub.def.connected || !conn || !port) return null;
    return { line: port.generateLine(this.elapsedSeconds()), sessionId: conn.sessionId };
  }

  healthMessages(): HealthMessage[] {
    return Array.from(this.hubs.values())
      .filter((hub) => hub.def.connected)
      .map((hub) => ({
        type: 'health',
        hubId: hub.def.hubId,
        timestamp: iso(),
        cpu_percent: Math.round(15 + Math.random() * 20),
        memory_percent: Math.round(35 + Math.random() * 10),
        disk_percent: 41,
        mode: hub.def.profile?.mode ?? null,
        uplink: hub.def.uplink ? { active: hub.def.uplink, stale: false } : null,
      }));
  }

  // --- Commands ---

  /** Accepts a command like the cloud does, then plays out its lifecycle like a hub. */
  queueCommand(
    hub: HubState,
    commandType: CommandType,
    portId: string,
    priority: number,
    params: Record<string, unknown>
  ): TaskStatusResponse {
    const taskId = `cmd-${uuid()}`;
    const createdAt = iso();

    const status = (state: string, extra: { result?: Record<string, unknown>; error?: string } = {}) =>
      this.broadcast({
        type: 'task_status',
        hubId: hub.def.hubId,
        task_id: taskId,
        status: state,
        progress: null,
        result: extra.result ?? null,
        error: extra.error ?? null,
        timestamp: iso(),
        commandType,
        portId,
      });

    window.setTimeout(() => status('pending'), TASK_START_DELAY_MS / 2);
    window.setTimeout(() => status('running'), TASK_START_DELAY_MS);
    window.setTimeout(() => {
      try {
        status('completed', { result: this.applyCommand(hub, commandType, portId, params) });
      } catch (e) {
        status('failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }, TASK_START_DELAY_MS + COMMAND_DURATION_MS[commandType]);

    return {
      task_id: taskId,
      status: 'pending',
      timestamp: createdAt,
      command_type: commandType,
      port_id: portId,
      hub_id: hub.def.hubId,
      priority,
      created_at: createdAt,
    };
  }

  private applyCommand(
    hub: HubState,
    commandType: CommandType,
    portId: string,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const port = this.findPort(hub, portId);
    if (!port) throw new Error(`Port not found: ${portId}`);

    switch (commandType) {
      case 'restart': {
        const conn = this.openConnection(portId);
        hub.connections.set(portId, conn);
        return { port_id: portId, restart_completed: true, session_id: conn.sessionId };
      }

      case 'serial_write': {
        const conn = hub.connections.get(portId);
        if (!conn) throw new Error(`Port ${portId} is not open`);
        const data = String(params.data ?? '');
        conn.bytesWritten += data.length;
        return { port_id: portId, bytes_written: data.length, encoding: params.encoding ?? 'utf-8' };
      }

      case 'flash': {
        const declared = (params.artifactFormat as ArtifactFormat | null | undefined) ?? null;
        const format = detectFormat(String(params.firmwareData ?? ''), declared);
        const board = port.info.board_profile;
        const formats = hub.def.capabilities.filter((c) => c.startsWith('flash:')).map((c) => c.slice(6));
        if (!formats.includes(format)) throw new Error(`Unsupported firmware format: ${format}`);
        if (board && board.artifacts && board.artifacts.length > 0 && !board.artifacts.includes(format)) {
          throw new Error(`${board.name} does not accept .${format} firmware`);
        }
        const fqbn = (params.boardFqbn as string | null | undefined) || board?.fqbn;
        if (format === 'ino' && !fqbn) throw new Error('Board FQBN is required for compiling .ino source files');
        hub.connections.set(portId, this.openConnection(portId));
        return {
          port_id: portId,
          artifact_format: format,
          board_fqbn: fqbn ?? null,
          board_profile: (params.boardProfile as string | undefined) ?? board?.id ?? null,
          output: 'Firmware flashed (mock)',
        };
      }

      case 'close_connection':
        if (!hub.connections.delete(portId)) throw new Error(`Port ${portId} is not open`);
        this.listeners.forEach((listener) => listener.dropSubscription(hub.def.hubId, portId));
        return { port_id: portId, status: 'closed' };
    }
  }
}

let serverInstance: MockHubServer | null = null;

export function getServer(): MockHubServer {
  serverInstance ??= new MockHubServer();
  return serverInstance;
}
