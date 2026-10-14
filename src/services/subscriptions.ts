import { webSocketService } from './websocket';
import { useHubStore } from '@/stores/hubStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { deviceKey } from '@/lib/format';
import type { DeviceSubscription } from '@/types';

/**
 * Subscribe and unsubscribe in one place, so the socket's subscription set and the UI's
 * (hubStore.activeSubscriptions) never drift apart. Returns how many devices were newly subscribed.
 */
export function subscribeDevices(devices: DeviceSubscription[]): number {
  const store = useHubStore.getState();
  const current = new Set(store.activeSubscriptions.map((s) => deviceKey(s.hubId, s.portId)));
  const fresh = devices.filter((d) => !current.has(deviceKey(d.hubId, d.portId)));
  if (fresh.length === 0) return 0;

  webSocketService.subscribe(fresh.map((d) => ({ hubId: d.hubId, portId: d.portId })));
  const subscribedAt = new Date().toISOString();
  for (const d of fresh) {
    store.addSubscription({ hubId: d.hubId, portId: d.portId, subscribedAt, confirmed: false });
  }
  return fresh.length;
}

export function unsubscribeDevice(hubId: string, portId: string): void {
  webSocketService.unsubscribe(hubId, portId);
  useHubStore.getState().removeSubscription(hubId, portId);
  useTelemetryStore.getState().removeFromLayout(deviceKey(hubId, portId));
}
