import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { CircleAlert, CircleCheck, LogOut } from 'lucide-react';
import loopIcon from '@/assets/loopIcon.png';
import { useAuthStore, useIsViewer } from '@/stores/authStore';
import { useHubStore } from '@/stores/hubStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { toast, useUiStore } from '@/stores/uiStore';
import { webSocketService } from '@/services/websocket';
import { unsubscribeDevice } from '@/services/subscriptions';
import { useCloudStatus, usePolling } from '@/hooks/useTicker';
import { deviceKey } from '@/lib/format';
import { deviceName, shortPath } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dot } from '@/components/ui/primitives';
import { Sheets } from '@/components/sheets/Sheets';
import { toTaskState, type WebSocketMessage } from '@/types';

const NAV = [
  { label: 'Hubs', to: '/' },
  { label: 'Devices', to: '/devices' },
  { label: 'Telemetry', to: '/telemetry' },
  { label: 'Flash', to: '/flash' },
] as const;

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Live updates from the cloud: telemetry, task progress, hub health and device events. */
function handleSocketMessage(message: WebSocketMessage): void {
  const hubs = useHubStore.getState();
  switch (message.type) {
    case 'telemetry_stream':
      useTelemetryStore.getState().processTelemetry(message);
      hubs.confirmSubscriptions([deviceKey(message.hubId, message.portId)]);
      break;

    case 'subscription_status':
      hubs.confirmSubscriptions(
        message.subscriptions.filter((s) => s.status === 'active').map((s) => deviceKey(s.hubId, s.portId))
      );
      break;

    case 'task_status': {
      const before = hubs.tasks.find((t) => t.task_id === message.task_id);
      const status = toTaskState(message.status);
      hubs.updateTaskStatus({
        task_id: message.task_id,
        status,
        result: message.result ?? undefined,
        error: message.error,
        progress: message.progress,
      });
      if (before && !TERMINAL.has(before.status) && TERMINAL.has(status)) announceTask(before.command_type, before.hub_id, before.port_id, status, message.error);
      break;
    }

    case 'health':
      hubs.updateHealth(message.hubId, message);
      break;

    case 'hub_status':
      // A hub came online or went offline: refresh the hub list (devices follow, see AppShell)
      void hubs.fetchHubs();
      break;

    case 'device_event':
      if (message.event === 'disconnected' && hubs.activeSubscriptions.some((s) => s.hubId === message.hubId && s.portId === message.portId)) {
        unsubscribeDevice(message.hubId, message.portId);
        toast(`A subscribed device disconnected from ${message.hubId}`, 'error');
      }
      void useDeviceStore.getState().refresh();
      break;
  }
}

/** Toast when a restart or flash finishes; serial writes are too frequent to announce. */
function announceTask(commandType: string, hubId: string, portId: string, status: string, error: string | null): void {
  const port = useDeviceStore.getState().byHub[hubId]?.ports.find((p) => p.port_id === portId);
  const what = port ? `${deviceName(port)} (${shortPath(port.port)})` : portId;
  if (commandType === 'restart') {
    if (status === 'completed') toast(`Restarted ${what} on ${hubId}`);
    else toast(`Restart failed on ${hubId}: ${error ?? status}`, 'error');
  } else if (commandType === 'flash') {
    if (status === 'completed') toast(`Flash completed on ${hubId}`);
    else toast(`Flash failed on ${hubId}: ${error ?? status}`, 'error');
  }
}

function CloudIndicator() {
  const status = useCloudStatus();
  const { label, tone, title } = {
    connected: { label: 'Cloud connected', tone: 'ok' as const, title: 'Live updates are streaming from the cloud' },
    connecting: { label: 'Connecting…', tone: 'warn' as const, title: 'Opening the live connection to the cloud' },
    reconnecting: { label: 'Reconnecting…', tone: 'warn' as const, title: 'Lost the live connection; retrying with backoff' },
    offline: { label: 'Offline', tone: 'off' as const, title: 'No live connection to the cloud' },
  }[status];
  return (
    <div title={title} className="flex items-center gap-2 text-[13px] whitespace-nowrap text-fg-2">
      <Dot tone={tone} />
      <span className="max-md:hidden">{label}</span>
    </div>
  );
}

function Header() {
  const { user, logout } = useAuthStore();
  const viewer = useIsViewer();
  const streams = useHubStore((s) => s.activeSubscriptions.length);
  const name = user?.username || 'user';

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-7 border-b border-control bg-ink px-6 max-lg:gap-4 max-sm:gap-2 max-sm:px-3">
      <Link to="/" className="flex shrink-0 items-center gap-2.5 text-fg hover:text-fg">
        <img src={loopIcon} alt="" className="size-[30px] object-contain" />
        <span className="text-base font-extrabold tracking-[-0.02em] whitespace-nowrap max-sm:hidden">Hub Manager</span>
      </Link>

      <nav aria-label="Main" className="flex h-14 min-w-0 items-center gap-0.5 overflow-x-auto">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'relative inline-flex h-14 items-center gap-2 px-3.5 text-sm font-semibold whitespace-nowrap max-sm:px-2.5',
                isActive ? 'text-fg' : 'text-fg-2 hover:text-fg'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span>{item.label}</span>
                {item.to === '/telemetry' && streams > 0 && (
                  <span className="h-[18px] min-w-[18px] rounded-full bg-brand px-[5px] text-center text-[11px] leading-[18px] font-bold text-white">
                    {streams}
                  </span>
                )}
                <span aria-hidden className={cn('absolute inset-x-3.5 bottom-0 h-0.5 max-sm:inset-x-2.5', isActive ? 'bg-brand' : 'bg-transparent')} />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />
      <CloudIndicator />
      {viewer && (
        <span
          title="View-only sessions cannot send commands"
          className="rounded-[3px] border border-warn px-2 py-[3px] text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-warn uppercase max-sm:hidden"
        >
          View only
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-line text-xs font-bold max-sm:hidden">
          {name[0]?.toUpperCase()}
        </span>
        <span className="font-mono text-[13px] text-fg-2 max-lg:hidden">{name}</span>
        <Button variant="ghost" size="icon" onClick={logout} title="Sign out" aria-label="Sign out">
          <LogOut size={16} />
        </Button>
      </div>
    </header>
  );
}

function ToastView() {
  const current = useUiStore((s) => s.toast);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (!current) return null;
  const Icon = current.tone === 'ok' ? CircleCheck : CircleAlert;
  return (
    <div
      role="status"
      onClick={dismiss}
      className="fixed bottom-6 left-6 z-[80] flex max-w-[420px] items-center gap-2.5 rounded-md border border-line-strong bg-ink px-4 py-3.5 text-sm shadow-[0_16px_48px_rgba(0,0,0,0.6)] max-sm:right-4 max-sm:left-4"
    >
      <Icon size={16} className={cn('shrink-0', current.tone === 'ok' ? 'text-ok' : 'text-brand-ink')} />
      <span>{current.message}</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const fetchHubs = useHubStore((s) => s.fetchHubs);
  const hubs = useHubStore((s) => s.hubs);

  useEffect(() => webSocketService.onMessage(handleSocketMessage), []);

  // Hub list every 30 s (and on hub_status); devices reload whenever the list changes
  usePolling(fetchHubs, 30000);
  useEffect(() => {
    if (hubs.length > 0) void useDeviceStore.getState().refresh();
  }, [hubs]);

  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      <main className="mx-auto max-w-[1440px] px-8 pt-10 pb-36 max-sm:px-4 max-sm:pt-6">{children}</main>
      <Sheets />
      <ToastView />
    </div>
  );
}
