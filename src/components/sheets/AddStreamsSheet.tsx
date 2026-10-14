import { useState } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { toast } from '@/stores/uiStore';
import { subscribeDevices } from '@/services/subscriptions';
import { deviceKey, plural, splitKey } from '@/lib/format';
import { deviceName, useStreamState } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CheckBox } from '@/components/ui/primitives';
import { Sheet, SheetBody, SheetFooter } from '@/components/ui/overlay';

export function AddStreamsSheet({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const hubs = useHubStore((s) => s.hubs).filter((h) => h.connected);
  const byHub = useDeviceStore((s) => s.byHub);
  const streamState = useStreamState();

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const subscribe = () => {
    const n = subscribeDevices(Array.from(picked, splitKey));
    toast(`Subscribing to ${plural(n, 'device')}`);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      kicker="Telemetry"
      title="Add streams"
      meta={<span className="text-fg-2">Charts appear as soon as a sensor header is detected.</span>}
    >
      <SheetBody>
        {hubs.length === 0 && <div className="mt-5 text-sm text-fg-3">No hubs are online.</div>}
        {hubs.map((hub) => {
          const ports = byHub[hub.hubId]?.ports ?? [];
          return (
            <div key={hub.hubId} className="mt-5">
              <div className="kicker">{hub.hubId}</div>
              <div className="mt-1.5 border-t border-line-panel">
                {ports.length === 0 && <div className="py-3 text-sm text-fg-3">No devices reported.</div>}
                {ports.map((p) => {
                  const key = deviceKey(hub.hubId, p.port_id);
                  const taken = streamState(hub.hubId, p.port_id) !== 'idle';
                  const checked = picked.has(key);
                  return (
                    <div
                      key={key}
                      onClick={() => !taken && toggle(key)}
                      className={cn('flex items-center gap-3.5 border-b border-line-panel py-3', taken ? 'opacity-45' : 'cursor-pointer')}
                    >
                      <CheckBox checked={checked || taken} disabled={taken} onChange={() => toggle(key)} label={taken ? 'Already subscribed' : `Select ${deviceName(p)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{deviceName(p)}</div>
                        <div className="font-mono text-xs text-fg-3">{p.port}</div>
                      </div>
                      {taken && <span className="text-[13px] font-bold text-brand-ink">Live</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </SheetBody>
      <SheetFooter>
        <Button variant="primary" size="xl" disabled={picked.size === 0} onClick={subscribe}>
          {picked.size ? `Subscribe to ${plural(picked.size, 'device')}` : 'Select devices'}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
