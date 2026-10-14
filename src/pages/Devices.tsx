import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw, RotateCw, Zap } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { connectionFor, idleRemaining, useDeviceStore } from '@/stores/deviceStore';
import { toast, useUiStore } from '@/stores/uiStore';
import { useIsViewer } from '@/stores/authStore';
import { subscribeDevices, unsubscribeDevice } from '@/services/subscriptions';
import { useNow, usePolling } from '@/hooks/useTicker';
import { restartDevice, useOpenFlash } from '@/hooks/useDeviceActions';
import { ago, bytes, deviceKey, msSince, plural, splitKey } from '@/lib/format';
import { deviceDetail, deviceName, useStreamState } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CheckBox, Dot, PageHeader, StreamState } from '@/components/ui/primitives';
import { rowAction } from '@/lib/rowAction';
import type { HubInfo, PortInfo } from '@/types';

const GRID = 'grid grid-cols-[28px_minmax(240px,2fr)_128px_80px_180px_140px_268px] items-center gap-4';

/** Idle countdown shown once a connection has been quiet for half the timeout. */
const SHOW_IDLE_BELOW_MS = 30 * 1000;

function DeviceRow({ hub, port, now }: { hub: HubInfo; port: PortInfo; now: number }) {
  const key = deviceKey(hub.hubId, port.port_id);
  const devices = useDeviceStore((s) => s.byHub[hub.hubId]);
  const activity = useDeviceStore((s) => s.activity);
  const selected = useHubStore((s) => s.selectedDevices.has(key));
  const toggle = useHubStore((s) => s.toggleDeviceSelection);
  const busy = useHubStore((s) => !!s.getActiveTaskForPort(port.port_id));
  const viewer = useIsViewer();
  const state = useStreamState()(hub.hubId, port.port_id);
  const openSheet = useUiStore((s) => s.openSheet);
  const openFlash = useOpenFlash();

  const conn = connectionFor(devices, port.port_id);
  const remaining = conn ? idleRemaining(activity, hub.hubId, conn, now) : null;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const restartTitle = viewer
    ? 'View-only mode cannot send commands'
    : !conn
      ? 'No open serial connection to restart'
      : busy
        ? 'Command in progress…'
        : 'Restart device';

  return (
    <div
      {...rowAction(() => openSheet({ kind: 'device', key }))}
      className={cn(GRID, 'min-h-[60px] cursor-pointer border-b border-line-soft px-3 py-2 hover:bg-hover', selected && 'bg-[#141414]')}
    >
      <CheckBox
        checked={selected}
        disabled={state !== 'idle'}
        onChange={() => toggle(hub.hubId, port.port_id)}
        label={state !== 'idle' ? 'Already subscribed' : selected ? 'Deselect' : 'Select'}
      />
      <div className="min-w-0">
        <div className="truncate text-[15px] leading-5 font-semibold">{deviceName(port)}</div>
        <div className="truncate text-xs leading-4 text-fg-3">{deviceDetail(port) || 'Unknown device'}</div>
      </div>
      <div className="truncate font-mono text-[13px]">{port.port}</div>
      <div className="font-mono text-[13px] text-fg-2">{conn?.baud_rate ?? '—'}</div>
      <div className="font-mono text-xs whitespace-pre text-fg-2">
        {conn ? `↓ ${bytes(conn.bytes_read)}   ↑ ${bytes(conn.bytes_written)}` : 'No open connection'}
      </div>
      <div className="flex flex-col">
        <StreamState state={state} />
        {remaining != null && remaining <= SHOW_IDLE_BELOW_MS && (
          <span className="text-[11px] text-warn" title="Connections with no traffic for 60 s are closed">
            Quiet · closes in {Math.ceil(remaining / 1000)}s
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Restart device"
          title={restartTitle}
          disabled={viewer || busy || !conn}
          onClick={stop(() => void restartDevice(hub.hubId, port.port_id))}
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCw size={16} />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Flash firmware" title="Flash firmware to this board" onClick={stop(() => openFlash(hub.hubId, port.port_id))}>
          <Zap size={16} />
        </Button>
        {state === 'idle' ? (
          <Button variant="light" size="xs" className="w-28" onClick={stop(() => subscribeDevices([{ hubId: hub.hubId, portId: port.port_id }]))}>
            Subscribe
          </Button>
        ) : (
          <Button variant="ghost" size="xs" className="w-28" onClick={stop(() => unsubscribeDevice(hub.hubId, port.port_id))}>
            {state === 'pending' ? 'Cancel' : 'Unsubscribe'}
          </Button>
        )}
      </div>
    </div>
  );
}

function HubGroup({ hub, now, collapsed, onToggle }: { hub: HubInfo; now: number; collapsed: boolean; onToggle: () => void }) {
  const devices = useDeviceStore((s) => s.byHub[hub.hubId]);
  const selectedDevices = useHubStore((s) => s.selectedDevices);
  const streamState = useStreamState();
  const ports = hub.connected ? (devices?.ports ?? []) : [];
  const selectable = ports.filter((p) => streamState(hub.hubId, p.port_id) === 'idle').map((p) => deviceKey(hub.hubId, p.port_id));
  const allSelected = selectable.length > 0 && selectable.every((k) => selectedDevices.has(k));
  const lastSeen = msSince(hub.lastSeen, now);

  const selectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedDevices);
    selectable.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
    useHubStore.setState({ selectedDevices: next });
  };

  const meta = !hub.connected
    ? `Offline${lastSeen != null ? ` · last seen ${ago(lastSeen)}` : ''}`
    : devices?.error
      ? devices.error
      : `${plural(ports.length, 'device')} · ${plural(devices?.connections.length ?? 0, 'open connection')}`;

  return (
    <div>
      <div
        {...rowAction(onToggle)}
        aria-expanded={!collapsed}
        className="mt-3 flex h-[52px] cursor-pointer items-center gap-3 border-b border-line px-3 hover:bg-hover"
      >
        {collapsed ? <ChevronRight size={16} className="text-fg-3" /> : <ChevronDown size={16} className="text-fg-3" />}
        <Dot tone={hub.connected ? 'ok' : 'off'} />
        <span className="text-base font-bold tracking-[-0.01em]">{hub.hubId}</span>
        <span className={cn('text-[13px]', devices?.error ? 'text-brand-ink' : 'text-fg-3')}>{meta}</span>
        <span className="flex-1" />
        {!collapsed && selectable.length > 0 && (
          <Button variant="ghost" size="xs" onClick={selectAll}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </Button>
        )}
      </div>
      {!collapsed && hub.connected && ports.length === 0 && !devices?.error && (
        <div className="border-b border-line-soft px-12 py-4 text-[13px] text-fg-3">No devices detected on this hub.</div>
      )}
      {!collapsed && ports.map((p) => <DeviceRow key={p.port_id} hub={hub} port={p} now={now} />)}
    </div>
  );
}

export function Devices() {
  const now = useNow(1000);
  const hubs = useHubStore((s) => s.hubs);
  const subsCount = useHubStore((s) => s.activeSubscriptions.length);
  const selectedDevices = useHubStore((s) => s.selectedDevices);
  const clearSelection = useHubStore((s) => s.clearDeviceSelection);
  const byHub = useDeviceStore((s) => s.byHub);
  const isRefreshing = useDeviceStore((s) => s.isRefreshing);
  const refresh = useDeviceStore((s) => s.refresh);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Same cadence and idle-connection cleanup as the old Device Manager
  const poll = useCallback(() => refresh({ enforceInactivity: true }), [refresh]);
  usePolling(poll, 10000);

  const online = hubs.filter((h) => h.connected);
  const total = online.reduce((n, h) => n + (byHub[h.hubId]?.ports.length ?? 0), 0);
  const selected = Array.from(selectedDevices);

  const toggleGroup = (hubId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(hubId)) next.delete(hubId);
      else next.add(hubId);
      return next;
    });

  const subscribeSelected = () => {
    const n = subscribeDevices(selected.map(splitKey));
    clearSelection();
    toast(`Subscribing to ${plural(n, 'device')}`);
  };

  return (
    <section className="flex flex-col gap-7">
      <PageHeader
        title="Devices"
        subtitle={`${plural(total, 'device')} on ${plural(online.length, 'online hub')} · ${subsCount} subscribed`}
        actions={
          <>
            <span className="text-[13px] text-fg-3 max-sm:hidden">Auto-refreshes every 10 s</span>
            <Button onClick={() => void poll()} disabled={isRefreshing}>
              <RefreshCw size={16} className={cn(isRefreshing && 'animate-spin')} />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      />

      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className={cn(GRID, 'kicker h-9 border-b border-line px-3')}>
            <span />
            <span>Device</span>
            <span>Port</span>
            <span>Baud</span>
            <span>Traffic</span>
            <span>Status</span>
            <span />
          </div>
          {hubs.map((hub) => (
            <HubGroup key={hub.hubId} hub={hub} now={now} collapsed={collapsed.has(hub.hubId) || !hub.connected} onToggle={() => toggleGroup(hub.hubId)} />
          ))}
          {hubs.length === 0 && (
            <div className="px-3 py-12 text-[15px] text-fg-3">No hubs are registered. Devices appear here once a Raspberry Pi hub connects.</div>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-line-strong bg-ink py-3 pr-3 pl-5 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold">{plural(selected.length, 'device')} selected</div>
            <div className="text-xs text-fg-3">Charts and terminals open in Telemetry</div>
          </div>
          <Button variant="ghost" size="lg" onClick={clearSelection}>
            Clear
          </Button>
          <Button variant="primary" size="lg" onClick={subscribeSelected}>
            Subscribe to {plural(selected.length, 'device')}
          </Button>
        </div>
      )}
    </section>
  );
}
