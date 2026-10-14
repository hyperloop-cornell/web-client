import { useCallback } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { useCloudStatus } from '@/hooks/useTicker';
import { deviceKey } from '@/lib/format';
import type { HubHealth, HubInfo, PortInfo } from '@/types';

/** What people call the device: the detected board, else whatever USB reports. */
export function deviceName(port: PortInfo): string {
  return port.board_profile?.name || port.description || port.manufacturer || port.port;
}

/** Second line under the name: USB description and serial number. */
export function deviceDetail(port: PortInfo): string {
  return [port.board_profile ? port.description : port.manufacturer, port.serial_number ? `SN ${port.serial_number}` : null]
    .filter(Boolean)
    .join(' · ');
}

export function shortPath(path: string): string {
  return path.replace(/^\/dev\//, '');
}

/** Wi-Fi or cellular: live value from health messages, else what the hub announced at handshake. */
export function uplinkOf(hub: HubInfo, health: HubHealth | undefined): string | null {
  if (!hub.connected) return null;
  const live = health?.uplink;
  if (live && !live.stale && typeof live.active === 'string') return live.active;
  return hub.profile?.uplink ?? null;
}

export type StreamStateKind = 'live' | 'pending' | 'idle';

/**
 * Subscription state per device: live once the cloud confirms it (or data arrives) while the
 * socket is up, connecting before that, idle when not subscribed.
 */
export function useStreamState(): (hubId: string, portId: string) => StreamStateKind {
  const subs = useHubStore((s) => s.activeSubscriptions);
  const cloud = useCloudStatus();
  return useCallback(
    (hubId: string, portId: string) => {
      const sub = subs.find((s) => s.hubId === hubId && s.portId === portId);
      if (!sub) return 'idle';
      return sub.confirmed && cloud === 'connected' ? 'live' : 'pending';
    },
    [subs, cloud]
  );
}

/** Subscribed device keys, oldest first. */
export function useSubscribedKeys(): string[] {
  const subs = useHubStore((s) => s.activeSubscriptions);
  return subs.map((s) => deviceKey(s.hubId, s.portId));
}
