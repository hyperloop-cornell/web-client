import { useEffect, useState, useSyncExternalStore } from 'react';
import { webSocketService, type CloudStatus } from '@/services/websocket';

/** Current time, refreshed every `intervalMs` so relative times and charts keep moving. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Runs `fn` now and then every `intervalMs` while mounted. `fn` should be stable. */
export function usePolling(fn: () => unknown, intervalMs: number): void {
  useEffect(() => {
    void fn();
    const id = window.setInterval(() => void fn(), intervalMs);
    return () => window.clearInterval(id);
  }, [fn, intervalMs]);
}

/** Cloud WebSocket status for the header indicator. */
export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(
    (onChange) => webSocketService.onStatusChange(onChange),
    () => webSocketService.getStatus()
  );
}
