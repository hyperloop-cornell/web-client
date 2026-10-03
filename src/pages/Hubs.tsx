import { useState } from 'react';
import { ChevronRight, RadioTower, Search, Wifi } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { useUiStore } from '@/stores/uiStore';
import { hubFlashFormats } from '@/config/boards';
import { useNow } from '@/hooks/useTicker';
import { duration, msSince } from '@/lib/format';
import { uplinkOf } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Chip, Dot, Meter, PageHeader, Segmented } from '@/components/ui/primitives';
import { rowAction } from '@/lib/rowAction';

type Filter = 'all' | 'online' | 'offline';

const GRID = 'grid grid-cols-[minmax(200px,1.6fr)_104px_116px_88px_repeat(3,minmax(96px,1fr))_112px_minmax(160px,1.3fr)_16px] items-center gap-4';

function MeterCell({ value }: { value: number | null | undefined }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 text-right font-mono text-[13px]">{value != null ? `${Math.round(value)}%` : '—'}</span>
      <Meter value={value} className="max-w-16 flex-1" />
    </div>
  );
}

export function Hubs() {
  const now = useNow(5000);
  const hubs = useHubStore((s) => s.hubs);
  const health = useHubStore((s) => s.health);
  const isLoading = useHubStore((s) => s.isLoading);
  const error = useHubStore((s) => s.error);
  const subs = useHubStore((s) => s.activeSubscriptions);
  const byHub = useDeviceStore((s) => s.byHub);
  const openSheet = useUiStore((s) => s.openSheet);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const online = hubs.filter((h) => h.connected).length;
  const q = query.trim().toLowerCase();
  const rows = hubs.filter((h) => (filter === 'all' || (filter === 'online') === h.connected) && h.hubId.toLowerCase().includes(q));

  return (
    <section className="flex flex-col gap-7">
      <PageHeader
        title="Hubs"
        subtitle={`${online} of ${hubs.length} online · refreshes every 30 s`}
        actions={
          <>
            <div className="relative w-[260px] max-sm:w-full">
              <Search size={16} className="pointer-events-none absolute top-3 left-3 text-fg-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hubs"
                aria-label="Search hubs"
                className="h-10 w-full rounded-[4px] border border-transparent bg-field pr-3 pl-9 text-sm outline-none focus:border-fg"
              />
            </div>
            <Segmented
              label="Filter hubs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: hubs.length },
                { value: 'online', label: 'Online', count: online },
                { value: 'offline', label: 'Offline', count: hubs.length - online },
              ]}
            />
          </>
        }
      />

      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className={cn(GRID, 'kicker h-9 border-b border-line px-3')}>
            <span>Hub</span>
            <span>Status</span>
            <span>Uplink</span>
            <span>Devices</span>
            <span>CPU</span>
            <span>Memory</span>
            <span>Disk</span>
            <span>Up for</span>
            <span>Flashes</span>
            <span />
          </div>

          {rows.map((hub) => {
            const hl = hub.connected ? health[hub.hubId] : undefined;
            const up = uplinkOf(hub, hl);
            const ports = hub.connected ? byHub[hub.hubId]?.ports : undefined;
            const live = subs.filter((s) => s.hubId === hub.hubId).length;
            const connectedFor = msSince(hub.connectedAt, now);
            const lastSeen = msSince(hub.lastSeen, now);
            return (
              <div
                key={hub.hubId}
                {...rowAction(() => openSheet({ kind: 'hub', hubId: hub.hubId }))}
                className={cn(
                  GRID,
                  'min-h-[60px] cursor-pointer border-b border-line-soft px-3 py-2 hover:bg-hover',
                  hub.connected ? 'text-fg' : 'text-fg-3'
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-base leading-5 font-bold tracking-[-0.01em]">{hub.hubId}</div>
                  <div className="mt-0.5 truncate font-mono text-xs leading-4 text-fg-3">
                    {hub.version ? `v${hub.version}` : 'unknown version'} · {hub.profile?.name ?? 'older hub software'}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Dot tone={hub.connected ? 'ok' : 'off'} />
                  {hub.connected ? 'Online' : 'Offline'}
                </div>
                <div className={cn('flex items-center gap-1.5 text-sm', up === 'cellular' ? 'text-warn' : 'text-fg-2')}>
                  {up === 'cellular' && <RadioTower size={14} />}
                  {up === 'wifi' && <Wifi size={14} />}
                  <span>{up === 'cellular' ? 'Cellular' : up === 'wifi' ? 'Wi-Fi' : '—'}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px]">{ports ? ports.length : '—'}</span>
                  {live > 0 && <span className="text-xs font-semibold text-brand-ink">{live} live</span>}
                </div>
                <MeterCell value={hl?.cpu_percent} />
                <MeterCell value={hl?.memory_percent} />
                <MeterCell value={hl?.disk_percent} />
                <div className="font-mono text-[13px] whitespace-nowrap">
                  {hub.connected ? (connectedFor != null ? duration(connectedFor) : '—') : lastSeen != null ? `seen ${duration(lastSeen)} ago` : 'never seen'}
                </div>
                <div className="flex flex-wrap gap-1">
                  {hub.connected && hubFlashFormats(hub.capabilities).map((f) => <Chip key={f}>.{f}</Chip>)}
                </div>
                <ChevronRight size={16} className="text-fg-4" />
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="px-3 py-12 text-[15px] text-fg-3">
              {isLoading && hubs.length === 0
                ? 'Loading hubs…'
                : error && hubs.length === 0
                  ? error
                  : q
                    ? `No hubs match "${query}".`
                    : hubs.length === 0
                      ? 'No hubs have registered with the cloud yet.'
                      : 'No hubs in this view.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
