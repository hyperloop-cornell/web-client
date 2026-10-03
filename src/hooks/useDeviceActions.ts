import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { commandService } from '@/services/commandService';
import { subscribeDevices } from '@/services/subscriptions';
import { useHubStore } from '@/stores/hubStore';
import { useIsViewer } from '@/stores/authStore';
import { toast, useUiStore } from '@/stores/uiStore';
import { splitKey } from '@/lib/format';

/** Restart a board (DTR toggle or OpenOCD reset, decided by the hub). Completion is toasted by AppShell. */
export async function restartDevice(hubId: string, portId: string): Promise<void> {
  const result = await commandService.restart(hubId, portId, undefined, { showSuccessToast: false, showErrorToast: false });
  if (!result.success) toast(`Could not restart: ${result.error ?? 'unknown error'}`, 'error');
}

/** Whether a command is queued or running on this port, and whether this session may send one. */
export function usePortCommandState(portId: string): { busy: boolean; viewer: boolean; restartTitle: string } {
  const busy = useHubStore((s) => !!s.getActiveTaskForPort(portId));
  const viewer = useIsViewer();
  return {
    busy,
    viewer,
    restartTitle: viewer ? 'View-only mode cannot send commands' : busy ? 'Command in progress…' : 'Restart device',
  };
}

/** Subscribe if needed, go to Telemetry and open the device's serial terminal. */
export function useOpenTerminal(): (key: string) => void {
  const navigate = useNavigate();
  const openSheet = useUiStore((s) => s.openSheet);
  return useCallback(
    (key: string) => {
      subscribeDevices([splitKey(key)]);
      navigate('/telemetry');
      openSheet({ kind: 'terminal', key });
      window.scrollTo(0, 0);
    },
    [navigate, openSheet]
  );
}

/** Go to the Flash page with this hub and port preselected. */
export function useOpenFlash(): (hubId: string, portId: string) => void {
  const navigate = useNavigate();
  const closeSheet = useUiStore((s) => s.closeSheet);
  return useCallback(
    (hubId: string, portId: string) => {
      closeSheet();
      navigate(`/flash?${new URLSearchParams({ hub: hubId, port: portId })}`);
      window.scrollTo(0, 0);
    },
    [navigate, closeSheet]
  );
}
