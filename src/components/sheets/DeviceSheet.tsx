import type { ReactNode } from 'react';
import { LoaderCircle, RotateCw, SquareTerminal, Zap } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { connectionFor, useDeviceStore } from '@/stores/deviceStore';
import { subscribeDevices, unsubscribeDevice } from '@/services/subscriptions';
import { hubFlashFormats } from '@/config/boards';
import { useNow } from '@/hooks/useTicker';
import { restartDevice, useOpenFlash, useOpenTerminal, usePortCommandState } from '@/hooks/useDeviceActions';
import { bytes, duration, msSince, splitKey } from '@/lib/format';
import { deviceName, useStreamState } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dot, Fact } from '@/components/ui/primitives';
import { Sheet, SheetBody, SheetFooter } from '@/components/ui/overlay';

function Tile({ icon, label, onClick, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1.5 rounded-[4px] border-0 bg-field text-[13px] font-semibold hover:bg-line',
        disabled && 'cursor-not-allowed text-fg-4 hover:bg-field'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function DeviceSheet({ deviceKey, onClose }: { deviceKey: string; onClose: () => void }) {
  const now = useNow();
  const { hubId, portId } = splitKey(deviceKey);
  const hub = useHubStore((s) => s.hubs.find((h) => h.hubId === hubId));
  const devices = useDeviceStore((s) => s.byHub[hubId]);
  const state = useStreamState()(hubId, portId);
  const { busy, viewer, restartTitle } = usePortCommandState(portId);
  const openTerminal = useOpenTerminal();
  const openFlash = useOpenFlash();

  const port = devices?.ports.find((p) => p.port_id === portId);
  if (!port) {
    return (
      <Sheet open onClose={onClose} kicker={`Device · ${hubId}`} title={portId}>
        <SheetBody className="pt-6 text-fg-3">The hub no longer reports this device. It may have been unplugged.</SheetBody>
      </Sheet>
    );
  }

  const conn = connectionFor(devices, portId);
  const board = port.board_profile ?? undefined;
  const hubFormats = hubFlashFormats(hub?.capabilities);
  const accepts = board?.artifacts?.length ? hubFormats.filter((f) => board.artifacts!.includes(f)) : hubFormats;
  const openFor = msSince(conn?.connected_at, now);

  const facts: [string, string, boolean][] = [
    ['Port', port.port, true],
    ['Port ID', port.port_id, true],
    ['Board', board ? `${board.name} (detected)` : 'Not detected', false],
    ['FQBN', board?.fqbn ?? '—', true],
    ['Accepts', accepts.map((f) => `.${f}`).join('  ') || '—', true],
    ['Baud rate', conn ? String(conn.baud_rate) : '—', true],
    ['Session', conn?.session_id ?? 'No open connection', !!conn],
    ['Traffic', conn ? `↓ ${bytes(conn.bytes_read)}  ↑ ${bytes(conn.bytes_written)}` : '—', true],
    ['Open for', openFor != null ? duration(openFor) : '—', true],
    ['USB ID', port.vendor_id && port.product_id ? `${port.vendor_id}:${port.product_id}` : '—', true],
    ['Manufacturer', port.manufacturer || '—', false],
    ['Serial number', port.serial_number || '—', true],
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      kicker={`Device · ${hubId}`}
      title={deviceName(port)}
      meta={
        state === 'live' ? (
          <span className="inline-flex items-center gap-2 font-bold text-brand-ink">
            <Dot tone="live" />
            Live · streaming to this browser
          </span>
        ) : state === 'pending' ? (
          <span className="text-warn">Connecting…</span>
        ) : (
          <span className="text-fg-2">Idle · not subscribed</span>
        )
      }
    >
      <div className="grid grid-cols-3 gap-2 border-b border-edge px-7 py-4 max-sm:px-5">
        <Tile
          icon={busy ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCw size={18} />}
          label={busy ? 'Restarting…' : 'Restart'}
          title={restartTitle}
          disabled={viewer || busy}
          onClick={() => void restartDevice(hubId, portId)}
        />
        <Tile icon={<Zap size={18} />} label="Flash firmware" onClick={() => openFlash(hubId, portId)} />
        <Tile icon={<SquareTerminal size={18} />} label="Open terminal" onClick={() => openTerminal(deviceKey)} />
      </div>

      <SheetBody className="pt-1 pb-6">
        {facts.map(([k, v, mono]) => (
          <Fact key={k} k={k} v={v} mono={mono} />
        ))}
      </SheetBody>

      <SheetFooter>
        {state === 'idle' ? (
          <Button variant="primary" size="xl" onClick={() => subscribeDevices([{ hubId, portId }])}>
            Subscribe
          </Button>
        ) : (
          <Button size="xl" onClick={() => unsubscribeDevice(hubId, portId)}>
            {state === 'pending' ? 'Cancel subscription' : 'Unsubscribe'}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
