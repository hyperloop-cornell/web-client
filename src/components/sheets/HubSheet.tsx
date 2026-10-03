import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { toast, useUiStore } from '@/stores/uiStore';
import { subscribeDevices } from '@/services/subscriptions';
import { hubFlashFormats } from '@/config/boards';
import { useNow } from '@/hooks/useTicker';
import { ago, duration, msSince, plural } from '@/lib/format';
import { deviceName, uplinkOf, useStreamState } from '@/lib/devices';
import { Button } from '@/components/ui/button';
import { Dot, Fact, Meter, StreamState } from '@/components/ui/primitives';
import { rowAction } from '@/lib/rowAction';
import { Sheet, SheetBody, SheetFooter } from '@/components/ui/overlay';

export function HubSheet({ hubId, onClose }: { hubId: string; onClose: () => void }) {
  const now = useNow();
  const navigate = useNavigate();
  const openSheet = useUiStore((s) => s.openSheet);
  const hub = useHubStore((s) => s.hubs.find((h) => h.hubId === hubId));
  const health = useHubStore((s) => s.health[hubId]);
  const devices = useDeviceStore((s) => s.byHub[hubId]);
  const streamState = useStreamState();

  if (!hub) {
    return (
      <Sheet open onClose={onClose} kicker="Hub" title={hubId}>
        <SheetBody className="pt-6 text-fg-3">This hub is no longer registered with the cloud.</SheetBody>
      </Sheet>
    );
  }

  const ports = hub.connected ? (devices?.ports ?? []) : [];
  const idle = ports.filter((p) => streamState(hubId, p.port_id) === 'idle');
  const uplink = uplinkOf(hub, health);
  const connectedFor = msSince(hub.connectedAt, now);
  const lastSeen = msSince(hub.lastSeen, now);
  const reportAge = msSince(health?.timestamp, now);

  const statusLine = hub.connected
    ? connectedFor != null
      ? `Online for ${duration(connectedFor)}`
      : 'Online'
    : lastSeen != null
      ? `Offline · last seen ${ago(lastSeen)}`
      : 'Offline · not seen since the cloud service started';

  const facts: [string, string][] = [
    ['Version', hub.version || 'Unknown'],
    ['Profile', hub.profile?.name ?? 'None (older hub software)'],
    ['Mode', hub.profile?.mode ?? health?.mode ?? 'bench'],
    ['Uplink', uplink === 'cellular' ? 'Cellular (Wi-Fi unavailable)' : uplink === 'wifi' ? 'Wi-Fi' : 'Not reported'],
    ['Connected', hub.connected && connectedFor != null ? ago(connectedFor) : '—'],
    ['Last seen', hub.connected ? 'now' : lastSeen != null ? ago(lastSeen) : '—'],
    ['Flash formats', hubFlashFormats(hub.capabilities).map((f) => `.${f}`).join('  ')],
  ];

  const subscribeIdle = () => {
    const n = subscribeDevices(idle.map((p) => ({ hubId, portId: p.port_id })));
    toast(`Subscribing to ${plural(n, 'device')} on ${hubId}`);
  };

  const go = (path: string) => {
    onClose();
    navigate(path);
    window.scrollTo(0, 0);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      kicker="Hub"
      title={hub.hubId}
      meta={
        <span className="flex items-center gap-2 text-fg-2">
          <Dot tone={hub.connected ? 'ok' : 'off'} />
          {statusLine}
        </span>
      }
    >
      <SheetBody>
        {facts.map(([k, v]) => (
          <Fact key={k} k={k} v={v} />
        ))}

        {hub.connected && (
          <>
            <div className="kicker mt-7">Health</div>
            {health ? (
              <>
                <div className="mt-3 flex flex-col gap-3.5">
                  {(
                    [
                      ['CPU', health.cpu_percent],
                      ['Memory', health.memory_percent],
                      ['Disk', health.disk_percent],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-sm">
                        <span>{k}</span>
                        <span className="font-mono text-[13px]">{v != null ? `${Math.round(v)}%` : '—'}</span>
                      </div>
                      <Meter value={v} size="lg" className="mt-1.5" />
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 text-xs text-fg-3">
                  Reported every 30 s{reportAge != null && ` · last report ${duration(reportAge)} ago`}
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm text-fg-3">Waiting for the first health report (sent every 30 s).</div>
            )}
          </>
        )}

        <div className="kicker mt-7">Devices · {ports.length}</div>
        <div className="mt-2 border-t border-line-panel">
          {ports.map((p) => (
            <div
              key={p.port_id}
              {...rowAction(() => openSheet({ kind: 'device', key: `${hubId}:${p.port_id}` }))}
              className="-mx-2 flex cursor-pointer items-center gap-3 rounded-[4px] border-b border-line-panel px-2 py-3 hover:bg-[#181818]"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{deviceName(p)}</div>
                <div className="font-mono text-xs text-fg-3">{p.port}</div>
              </div>
              <StreamState state={streamState(hubId, p.port_id)} />
              <ChevronRight size={16} className="text-fg-4" />
            </div>
          ))}
          {ports.length === 0 && <div className="py-3.5 text-sm text-fg-3">{hub.connected ? 'No devices reported.' : 'Hub is offline.'}</div>}
        </div>
      </SheetBody>

      <SheetFooter>
        {hub.connected ? (
          <>
            {idle.length > 0 ? (
              <Button variant="primary" size="xl" onClick={subscribeIdle}>
                Subscribe to {idle.length === ports.length ? 'all ' : ''}
                {plural(idle.length, 'device')}
              </Button>
            ) : (
              <Button variant="primary" size="xl" onClick={() => go('/telemetry')} disabled={ports.length === 0}>
                Open telemetry
              </Button>
            )}
            <Button size="md" className="h-11" onClick={() => go('/devices')}>
              Manage devices
            </Button>
          </>
        ) : (
          <div className="text-sm text-fg-3">This hub is offline. Its devices appear here when it reconnects.</div>
        )}
      </SheetFooter>
    </Sheet>
  );
}
