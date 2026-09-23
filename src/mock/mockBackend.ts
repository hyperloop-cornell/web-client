import {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import type {
  AuthToken,
  ConnectionInfo,
  DeviceSubscription,
  HubInfo,
  PortInfo,
  SubscriptionStatusMessage,
  TaskStatusResponse,
  TelemetryEntry,
  User,
  WebSocketMessage,
} from '@/types';
import {
  BYTES_PER_SECOND,
  MOCK_HUBS,
  TELEMETRY_INTERVAL_MS,
  type MockHubDef,
  type MockPortDef,
} from './mockData';

/**
 * Mock hub backend, so the web client can run with no cloud-services / RPi hubs behind it.
 *
 * Start it with `npm run dev:mock`. Two seams are faked:
 *   - REST:      an Axios adapter installed on the shared `api` instance (installMockAdapter)
 *   - WebSocket: a stand-in for `new WebSocket(...)` used by websocket.ts (createMockSocket)
 *
 * State lives in memory and resets on page reload. The mock only activates in the Vite dev
 * server, never in a production build.
 */
export const MOCK_HUBS_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MOCK_HUBS === 'true';

const MOCK_LATENCY_MS = 120;
const PING_INTERVAL_MS = 20000;

type CommandKind = 'serial_write' | 'flash' | 'restart' | 'close';

const COMMAND_DURATION_MS: Record<CommandKind, number> = {
  serial_write: 300,
  flash: 4000,
  restart: 1500,
  close: 500,
};

// Delay before a task reports "running", so the client has registered it from the HTTP response.
const TASK_START_DELAY_MS = 400;

// ---------------------------------------------------------------------------------------------
// In-memory hub server
// ---------------------------------------------------------------------------------------------

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

function uuid(): string {
  // crypto.randomUUID is unavailable on insecure origins (the dev server binds 0.0.0.0).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

class MockHubServer {
  private readonly startedAt = Date.now();
  private readonly hubs = new Map<string, HubState>();
  private readonly sockets = new Set<MockSocket>();

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
    return { portId, sessionId: uuid(), openedAt: Date.now(), bytesWritten: 0 };
  }

  private elapsedSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  private findPort(hub: HubState, portId: string): MockPortDef | undefined {
    return hub.def.ports.find((p) => p.info.port_id === portId);
  }

  // --- REST-facing reads ---

  getHub(hubId: string): HubState | undefined {
    return this.hubs.get(hubId);
  }

  listHubs(): HubInfo[] {
    return Array.from(this.hubs.values()).map((hub) => this.toHubInfo(hub));
  }

  toHubInfo(hub: HubState): HubInfo {
    return {
      hubId: hub.def.hubId,
      connected: hub.def.connected,
      connectedAt: hub.connectedAt ? new Date(hub.connectedAt).toISOString() : undefined,
      lastSeen: new Date(hub.def.connected ? Date.now() : hub.lastSeenAt).toISOString(),
      version: hub.def.version,
    };
  }

  listPorts(hub: HubState): PortInfo[] {
    return hub.def.connected ? hub.def.ports.map((p) => p.info) : [];
  }

  listConnections(hub: HubState): ConnectionInfo[] {
    const now = Date.now();
    const result: ConnectionInfo[] = [];

    for (const conn of hub.connections.values()) {
      const port = this.findPort(hub, conn.portId);
      if (!port) continue;
      result.push({
        port_id: conn.portId,
        status: 'open',
        baud_rate: port.baudRate,
        session_id: conn.sessionId,
        // Grows continuously so DeviceManager's inactivity check never trips on mock ports.
        bytes_read: Math.floor(((now - conn.openedAt) / 1000) * BYTES_PER_SECOND),
        bytes_written: conn.bytesWritten,
        connected_at: new Date(conn.openedAt).toISOString(),
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
          timestamp: new Date(at).toISOString(),
          portId: conn.portId,
          sessionId: conn.sessionId,
          data: btoa(line),
          dataSizeBytes: line.length,
        });
      }
    }
    return entries;
  }

  // --- Websocket-facing ---

  addSocket(socket: MockSocket): void {
    this.sockets.add(socket);
  }

  removeSocket(socket: MockSocket): void {
    this.sockets.delete(socket);
  }

  broadcast(message: WebSocketMessage): void {
    this.sockets.forEach((socket) => socket.deliver(message));
  }

  /** One fresh line of output for a port, or null if the port has no open connection. */
  sample(hubId: string, portId: string): { line: string; sessionId: string } | null {
    const hub = this.hubs.get(hubId);
    const conn = hub?.connections.get(portId);
    const port = hub && this.findPort(hub, portId);
    if (!hub || !conn || !port) return null;
    return { line: port.generateLine(this.elapsedSeconds()), sessionId: conn.sessionId };
  }

  // --- Commands ---

  /**
   * Accepts a command, then plays out its lifecycle over the websocket:
   * pending (returned to the caller) -> running -> completed.
   */
  queueCommand(
    hub: HubState,
    kind: CommandKind,
    portId: string,
    priority: number,
    payload = ''
  ): TaskStatusResponse {
    const taskId = uuid();
    const createdAt = new Date().toISOString();

    window.setTimeout(() => {
      this.broadcast({
        type: 'task_status',
        task_id: taskId,
        status: 'running',
        timestamp: new Date().toISOString(),
      });
    }, TASK_START_DELAY_MS);

    window.setTimeout(() => {
      const result = this.applyCommand(hub, kind, portId, payload);
      this.broadcast({
        type: 'task_status',
        task_id: taskId,
        status: 'completed',
        result,
        timestamp: new Date().toISOString(),
      });
    }, TASK_START_DELAY_MS + COMMAND_DURATION_MS[kind]);

    return { task_id: taskId, command_type: kind, status: 'pending', priority, created_at: createdAt };
  }

  private applyCommand(hub: HubState, kind: CommandKind, portId: string, payload: string): string {
    switch (kind) {
      case 'restart':
        // A restarted board opens a fresh serial session.
        hub.connections.set(portId, this.openConnection(portId));
        return 'Device restarted (mock)';

      case 'serial_write': {
        const conn = hub.connections.get(portId);
        if (conn) conn.bytesWritten += payload.length;
        return `Wrote ${payload.length} bytes (mock)`;
      }

      case 'flash':
        return 'Firmware flashed (mock)';

      case 'close':
        if (hub.connections.delete(portId)) {
          this.sockets.forEach((socket) => socket.dropSubscription(hub.def.hubId, portId));
          this.broadcast({
            type: 'device_event',
            hubId: hub.def.hubId,
            portId,
            event: 'disconnected',
            timestamp: new Date().toISOString(),
          });
        }
        return 'Connection closed (mock)';
    }
  }
}

let serverInstance: MockHubServer | null = null;

function getServer(): MockHubServer {
  serverInstance ??= new MockHubServer();
  return serverInstance;
}

// ---------------------------------------------------------------------------------------------
// WebSocket stand-in
// ---------------------------------------------------------------------------------------------

function subscriptionKey(sub: DeviceSubscription): string {
  return `${sub.hubId}:${sub.portId}`;
}

/**
 * Implements just the slice of the WebSocket API that websocket.ts uses.
 * Behaves like the real server: acks subscribe/unsubscribe, streams telemetry for subscribed
 * ports, and sends periodic pings (the client replies with pongs and reconnects if it goes quiet).
 */
class MockSocket {
  readonly url: string;
  readyState = 0; // CONNECTING; the OPEN/CLOSED values match the real WebSocket constants

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private readonly subscriptions = new Map<string, DeviceSubscription>();
  private readonly timers: number[] = [];

  constructor(url: string) {
    this.url = url;

    // Open asynchronously, after the caller has assigned its handlers.
    window.setTimeout(() => this.open(), 50);
  }

  private open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;

    getServer().addSocket(this);
    this.timers.push(window.setInterval(() => this.emitTelemetry(), TELEMETRY_INTERVAL_MS));
    this.timers.push(
      window.setInterval(
        () => this.deliver({ type: 'ping', timestamp: new Date().toISOString() }),
        PING_INTERVAL_MS
      )
    );

    this.onopen?.(new Event('open'));
  }

  send(raw: string): void {
    if (this.readyState !== 1) return;

    let message: { type?: string; subscriptions?: DeviceSubscription[] };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'subscribe') {
      this.handleSubscribe(message.subscriptions ?? []);
    } else if (message.type === 'unsubscribe') {
      this.handleUnsubscribe(message.subscriptions ?? []);
    }
    // 'pong' needs no handling.
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;

    this.timers.forEach((timer) => window.clearInterval(timer));
    this.timers.length = 0;
    this.subscriptions.clear();
    getServer().removeSocket(this);

    // Real sockets fire "close" asynchronously.
    window.setTimeout(() => this.onclose?.(new CloseEvent('close', { code, reason, wasClean: true })), 0);
  }

  /** Server -> client. */
  deliver(message: WebSocketMessage): void {
    if (this.readyState !== 1) return;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  dropSubscription(hubId: string, portId: string): void {
    this.subscriptions.delete(subscriptionKey({ hubId, portId }));
  }

  private handleSubscribe(requested: DeviceSubscription[]): void {
    const server = getServer();
    const statuses: SubscriptionStatusMessage['subscriptions'] = requested.map((sub) => {
      const available = server.sample(sub.hubId, sub.portId) !== null;
      if (available) this.subscriptions.set(subscriptionKey(sub), sub);
      return { hubId: sub.hubId, portId: sub.portId, status: available ? 'active' : 'inactive' };
    });
    this.deliver({ type: 'subscription_status', subscriptions: statuses });
  }

  private handleUnsubscribe(requested: DeviceSubscription[]): void {
    for (const sub of requested) {
      this.subscriptions.delete(subscriptionKey(sub));
    }
    this.deliver({
      type: 'subscription_status',
      subscriptions: requested.map((sub) => ({ hubId: sub.hubId, portId: sub.portId, status: 'inactive' as const })),
    });
  }

  private emitTelemetry(): void {
    const server = getServer();
    for (const { hubId, portId } of this.subscriptions.values()) {
      const sample = server.sample(hubId, portId);
      if (!sample) continue;

      const line = `${sample.line}\n`;
      this.deliver({
        type: 'telemetry_stream',
        hubId,
        portId,
        sessionId: sample.sessionId,
        timestamp: new Date().toISOString(),
        data: btoa(line),
        dataSizeBytes: line.length,
      });
    }
  }
}

/** Drop-in replacement for `new WebSocket(url)` (only the members websocket.ts touches exist). */
export function createMockSocket(url: string): WebSocket {
  return new MockSocket(url) as unknown as WebSocket;
}

// ---------------------------------------------------------------------------------------------
// REST: Axios adapter
// ---------------------------------------------------------------------------------------------

interface MockResult {
  status: number;
  data: unknown;
}

const ok = (data: unknown): MockResult => ({ status: 200, data });
const fail = (status: number, detail: string): MockResult => ({ status, data: { detail } });

type Role = 'admin' | 'viewer';

// Tokens are "mock:<role>:<username>" so /auth/me can answer without any server-side session.
function makeToken(role: Role, username: string): AuthToken {
  return { access_token: `mock:${role}:${encodeURIComponent(username)}`, token_type: 'bearer' };
}

function parseSession(config: InternalAxiosRequestConfig): User | null {
  const header = String(config.headers?.Authorization ?? '');
  const [, role, username] = /^Bearer mock:(admin|viewer):(.*)$/.exec(header) ?? [];
  return role ? { username: decodeURIComponent(username), role } : null;
}

function parseBody(data: unknown): Record<string, unknown> {
  if (data instanceof URLSearchParams) return Object.fromEntries(data.entries());
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      // Axios serializes the form-encoded login body to a string before the adapter sees it.
      return Object.fromEntries(new URLSearchParams(data).entries());
    }
  }
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

const HUB_ROUTE = /^\/api\/hubs\/([^/]+)(?:\/(ports|connections|telemetry|commands\/(?:write|flash|restart|close)))?$/;

const COMMAND_KINDS: Record<string, CommandKind> = {
  'commands/write': 'serial_write',
  'commands/flash': 'flash',
  'commands/restart': 'restart',
  'commands/close': 'close',
};

function route(config: InternalAxiosRequestConfig): MockResult {
  const server = getServer();
  const method = (config.method ?? 'get').toLowerCase();
  const path = (config.url ?? '').split('?')[0];

  // Auth. Any credentials are accepted.
  if (method === 'post' && path === '/auth/login') {
    const username = String(parseBody(config.data).username ?? '').trim() || 'admin';
    return ok(makeToken('admin', username));
  }
  if (method === 'post' && path === '/auth/login-viewer') {
    return ok(makeToken('viewer', 'viewer'));
  }

  const session = parseSession(config);
  if (!session) return fail(401, 'Not authenticated');

  if (method === 'get' && path === '/auth/me') return ok(session);
  if (method === 'get' && path === '/api/hubs') return ok(server.listHubs());

  const match = HUB_ROUTE.exec(path);
  if (!match) return fail(404, 'Not found');

  const hubId = decodeURIComponent(match[1]);
  const hub = server.getHub(hubId);
  if (!hub) return fail(404, `Hub '${hubId}' not found`);

  const sub = match[2];

  if (method === 'get') {
    switch (sub) {
      case undefined:
        return ok(server.toHubInfo(hub));
      case 'ports':
        return ok(server.listPorts(hub));
      case 'connections':
        return ok(server.listConnections(hub));
      case 'telemetry': {
        const limit = Number(config.params?.limit) || 100;
        return ok(server.history(hub, Math.min(limit, 500)));
      }
    }
    return fail(405, 'Method not allowed');
  }

  const kind = sub ? COMMAND_KINDS[sub] : undefined;
  if (method !== 'post' || !kind) return fail(405, 'Method not allowed');

  if (kind === 'flash' && session.role === 'viewer') {
    return fail(403, 'View-only users cannot flash firmware');
  }
  if (!hub.def.connected) return fail(503, `Hub '${hubId}' is not connected`);

  const body = parseBody(config.data);
  const portId = String(body.portId ?? '');
  if (!hub.def.ports.some((p) => p.info.port_id === portId)) return fail(404, `Port '${portId}' not found`);
  if (!hub.connections.has(portId)) return fail(409, `Port '${portId}' is not open`);

  const priority = typeof body.priority === 'number' ? body.priority : 1;
  const payload = String(body.data ?? '');
  const task = server.queueCommand(hub, kind, portId, priority, payload);

  if (kind === 'close') {
    return ok({ commandId: task.task_id, hubId, status: task.status, message: 'Close command queued (mock)' });
  }
  return ok(task);
}

/** Routes every request made through `instance` to the in-memory server instead of the network. */
export function installMockAdapter(instance: AxiosInstance): void {
  console.info(
    '%c[mock] Running against the mock hub backend. No network requests are made; any login works.',
    'color: #f59e0b; font-weight: bold'
  );

  instance.defaults.adapter = async (config) => {
    await new Promise((resolve) => window.setTimeout(resolve, MOCK_LATENCY_MS));

    const { status, data } = route(config);
    const response: AxiosResponse = {
      data,
      status,
      statusText: status < 400 ? 'OK' : 'Error',
      headers: {},
      config,
      request: {},
    };

    if (status >= 200 && status < 300) return response;

    const detail = (data as { detail: string }).detail;
    throw new AxiosError(
      detail,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response
    );
  };
}
