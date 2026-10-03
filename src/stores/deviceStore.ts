import { create } from 'zustand';
import { hubsApi } from '@/services/api';
import { unsubscribeDevice } from '@/services/subscriptions';
import { useHubStore } from './hubStore';
import type { ConnectionInfo, PortInfo } from '@/types';

/**
 * Ports and open serial connections for every online hub, shared by the Hubs, Devices,
 * Telemetry and Flash pages and the sheets.
 */

/** With enforceInactivity, a connection whose byte counters stall this long is closed. */
export const INACTIVE_TIMEOUT_MS = 60 * 1000;

export interface HubDevices {
  ports: PortInfo[];
  connections: ConnectionInfo[];
  error: string | null;
}

interface Activity {
  bytesRead: number;
  bytesWritten: number;
  lastActive: number;
}

interface DeviceState {
  byHub: Record<string, HubDevices>;
  /** Last time each connection's byte counters moved, keyed hubId:portId:sessionId. */
  activity: Record<string, Activity>;
  isRefreshing: boolean;
  lastRefresh: number | null;
  /**
   * Reload ports and connections. enforceInactivity (used by the Devices page, as before the
   * redesign) also closes connections idle for INACTIVE_TIMEOUT_MS and drops subscriptions
   * whose port has no open connection.
   */
  refresh: (options?: { enforceInactivity?: boolean }) => Promise<void>;
}

let inflight: Promise<void> | null = null;
// A refresh requested mid-flight runs once more afterwards, so callers that just changed the
// hub list (or want inactivity enforced) are never served stale results.
let queued: { enforceInactivity: boolean } | null = null;

const EMPTY: HubDevices = { ports: [], connections: [], error: null };

export const useDeviceStore = create<DeviceState>((set, get) => ({
  byHub: {},
  activity: {},
  isRefreshing: false,
  lastRefresh: null,

  refresh: ({ enforceInactivity = false } = {}) => {
    if (inflight) {
      queued = { enforceInactivity: (queued?.enforceInactivity ?? false) || enforceInactivity };
      return inflight;
    }

    inflight = (async () => {
      set({ isRefreshing: true });
      const hubs = useHubStore.getState().hubs.filter((h) => h.connected);
      const previous = get();
      const now = Date.now();
      const byHub: Record<string, HubDevices> = {};
      const activity: Record<string, Activity> = {};

      await Promise.all(
        hubs.map(async (hub) => {
          try {
            const [portsRaw, connectionsRaw] = await Promise.all([
              hubsApi.getPorts(hub.hubId),
              hubsApi.getConnections(hub.hubId),
            ]);
            // Deduplicate ports by port_id, keeping the last occurrence
            const ports = Array.from(new Map(portsRaw.map((p) => [p.port_id, p])).values());

            const connections: ConnectionInfo[] = [];
            for (const conn of connectionsRaw) {
              const key = `${hub.hubId}:${conn.port_id}:${conn.session_id}`;
              const prev = previous.activity[key];
              const moved = !prev || prev.bytesRead !== conn.bytes_read || prev.bytesWritten !== conn.bytes_written;
              const lastActive = moved ? now : prev.lastActive;
              activity[key] = { bytesRead: conn.bytes_read, bytesWritten: conn.bytes_written, lastActive };

              if (enforceInactivity && now - lastActive > INACTIVE_TIMEOUT_MS) {
                await closeIdleConnection(hub.hubId, conn.port_id);
              } else {
                connections.push(conn);
              }
            }

            if (enforceInactivity) {
              const open = new Set(connections.map((c) => c.port_id));
              for (const sub of useHubStore.getState().activeSubscriptions) {
                if (sub.hubId === hub.hubId && !open.has(sub.portId)) unsubscribeDevice(sub.hubId, sub.portId);
              }
            }

            byHub[hub.hubId] = { ports, connections, error: null };
          } catch (error) {
            console.error(`Failed to fetch devices for hub ${hub.hubId}:`, error);
            // Keep what we had so a transient error does not empty the tables
            byHub[hub.hubId] = { ...(previous.byHub[hub.hubId] ?? EMPTY), error: 'Could not load devices' };
            for (const [key, value] of Object.entries(previous.activity)) {
              if (key.startsWith(`${hub.hubId}:`)) activity[key] = value;
            }
          }
        })
      );

      set({ byHub, activity, isRefreshing: false, lastRefresh: Date.now() });
    })().finally(() => {
      inflight = null;
      if (queued) {
        const next = queued;
        queued = null;
        void get().refresh(next);
      }
    });

    return inflight;
  },
}));

async function closeIdleConnection(hubId: string, portId: string): Promise<void> {
  if (useHubStore.getState().activeSubscriptions.some((s) => s.hubId === hubId && s.portId === portId)) {
    unsubscribeDevice(hubId, portId);
  }
  try {
    await hubsApi.closeConnection(hubId, portId);
  } catch (error) {
    console.error(`Failed to close inactive connection ${hubId}:${portId}:`, error);
  }
}

export function connectionFor(devices: HubDevices | undefined, portId: string): ConnectionInfo | undefined {
  return devices?.connections.find((c) => c.port_id === portId);
}

/** Milliseconds until an idle connection is closed, or null when it is not being tracked. */
export function idleRemaining(activity: Record<string, Activity>, hubId: string, conn: ConnectionInfo, now = Date.now()): number | null {
  const a = activity[`${hubId}:${conn.port_id}:${conn.session_id}`];
  return a ? Math.max(0, INACTIVE_TIMEOUT_MS - (now - a.lastActive)) : null;
}
