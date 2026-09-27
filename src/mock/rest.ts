import { AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthToken, User, UserRole } from '@/types';
import { getServer, type CommandType } from './server';

const MOCK_LATENCY_MS = 120;

/** Same development credentials as cloud-services without a TEAM_PASSWORD_HASH. */
export const MOCK_TEAM_PASSWORD = 'hyperloop-dev';

interface MockResult {
  status: number;
  data: unknown;
}

const ok = (data: unknown): MockResult => ({ status: 200, data });
const fail = (status: number, detail: string): MockResult => ({ status, data: { detail } });

// Tokens are "mock:<role>:<username>" so /auth/me can answer without any server-side session.
function makeToken(role: UserRole, username: string): AuthToken {
  return { access_token: `mock:${role}:${encodeURIComponent(username)}`, token_type: 'bearer' };
}

function parseSession(config: InternalAxiosRequestConfig): User | null {
  const header = String(config.headers?.Authorization ?? '');
  const [, role, username] = /^Bearer mock:(operator|viewer):(.*)$/.exec(header) ?? [];
  if (!role) return null;
  const name = decodeURIComponent(username);
  return role === 'viewer'
    ? { username: 'viewer', email: null, full_name: 'View-Only User', role: 'viewer' }
    : { username: name, email: `${name}@cornell.edu`, full_name: null, role: 'operator' };
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

function normalizeNetid(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/@cornell\.edu$/, '');
}

const HUB_ROUTE = /^\/api\/hubs\/([^/]+)(?:\/(ports|connections|telemetry|commands\/(?:write|flash|restart|close)))?$/;

const COMMAND_TYPES: Record<string, CommandType> = {
  'commands/write': 'serial_write',
  'commands/flash': 'flash',
  'commands/restart': 'restart',
  'commands/close': 'close_connection',
};

const DEFAULT_PRIORITY: Record<CommandType, number> = {
  serial_write: 5,
  flash: 3,
  restart: 2,
  close_connection: 1,
};

function route(config: InternalAxiosRequestConfig): MockResult {
  const server = getServer();
  const method = (config.method ?? 'get').toLowerCase();
  const path = (config.url ?? '').split('?')[0];

  if (method === 'post' && path === '/auth/login') {
    const body = parseBody(config.data);
    const netid = normalizeNetid(body.username);
    if (!netid || !body.password) return fail(400, 'NetID and password are required');
    if (body.password !== MOCK_TEAM_PASSWORD) return fail(401, 'Incorrect NetID or password');
    return ok(makeToken('operator', netid));
  }
  if (method === 'post' && path === '/auth/login-viewer') {
    return ok(makeToken('viewer', 'viewer'));
  }

  const session = parseSession(config);
  if (!session) return fail(401, 'Not authenticated');

  if (method === 'get' && path === '/auth/me') return ok(session);
  if (method === 'get' && path === '/api/hubs') return ok(server.listHubs());

  const match = HUB_ROUTE.exec(path);
  if (!match) return fail(404, 'Not Found');

  const hubId = decodeURIComponent(match[1]);
  const hub = server.getHub(hubId);
  const sub = match[2];
  const commandType = sub ? COMMAND_TYPES[sub] : undefined;

  if (commandType) {
    if (method !== 'post') return fail(405, 'Method Not Allowed');
    // Checked before anything else, like require_operator in cloud-services
    if (session.role !== 'operator') return fail(403, 'View-only users cannot send commands');
    if (!hub || !hub.def.connected) return fail(404, `Hub not connected: ${hubId}`);

    const body = parseBody(config.data);
    const portId = String(body.portId ?? '');
    if (!portId) return fail(422, 'portId is required');

    const params: Record<string, unknown> = { ...body };
    delete params.portId;
    delete params.priority;
    const priority = typeof body.priority === 'number' ? body.priority : DEFAULT_PRIORITY[commandType];
    return ok(server.queueCommand(hub, commandType, portId, priority, params));
  }

  if (!hub) return fail(404, `Hub not found: ${hubId}`);
  if (method !== 'get') return fail(405, 'Method Not Allowed');

  switch (sub) {
    case undefined:
      return ok(server.toHubInfo(hub));
    case 'ports': {
      const ports = server.listPorts(hub);
      return ok({ hubId, ports, count: ports.length });
    }
    case 'connections': {
      const connections = server.listConnections(hub);
      return ok({ hubId, connections, count: connections.length });
    }
    case 'telemetry': {
      const limit = Math.min(Number(config.params?.limit) || 100, 1000);
      const telemetry = server.history(hub, Math.max(1, Math.floor(limit / Math.max(hub.connections.size, 1))));
      return ok({
        hubId,
        telemetry,
        count: telemetry.length,
        totalBytes: telemetry.reduce((sum, entry) => sum + entry.dataSizeBytes, 0),
      });
    }
  }
  return fail(404, 'Not Found');
}

/** Routes every request made through `instance` to the in-memory server instead of the network. */
export function installMockAdapter(instance: AxiosInstance): void {
  console.info(
    `%c[mock] Running against the in-browser mock backend. Log in with any NetID and password "${MOCK_TEAM_PASSWORD}", or View Only.`,
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
