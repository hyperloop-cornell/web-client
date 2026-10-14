import { useState, type DragEvent } from 'react';
import { ChevronDown, CircleAlert, Clock, GripVertical, Plus, SquareTerminal, Trash2 } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { toast, useUiStore } from '@/stores/uiStore';
import { deleteCustomSchema, getCustomSchemas } from '@/lib/customSchemas';
import { useNow } from '@/hooks/useTicker';
import { clock, deviceKey, plural } from '@/lib/format';
import { deviceName, shortPath, useStreamState } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dot, PageHeader, Segmented } from '@/components/ui/primitives';
import { rowAction } from '@/lib/rowAction';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, Modal } from '@/components/ui/overlay';
import { TextInput } from '@/components/ui/field';
import { ChartPanel, type Series } from '@/components/telemetry/ChartPanel';
import { chartColor, sequenceColor } from '@/lib/chartColors';
import type { CustomTimeRange, SensorMapping, TimeWindow } from '@/types';

const WINDOWS: { value: Exclude<TimeWindow, 'custom'>; minutes: number }[] = [
  { value: '5m', minutes: 5 },
  { value: '15m', minutes: 15 },
  { value: '30m', minutes: 30 },
  { value: '1h', minutes: 60 },
];

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Custom range picker; data older than an hour is not kept, so ranges are effectively within the last hour. */
function CustomRangeModal({ open, initial, onApply, onClose }: { open: boolean; initial: CustomTimeRange; onApply: (r: CustomTimeRange) => void; onClose: () => void }) {
  const [sd, setSd] = useState(dateInput(initial.start));
  const [st, setSt] = useState(timeInput(initial.start));
  const [ed, setEd] = useState(dateInput(initial.end));
  const [et, setEt] = useState(timeInput(initial.end));
  const [error, setError] = useState('');

  const apply = () => {
    if (!sd || !st || !ed || !et) return setError('Fill in both dates and times.');
    const start = new Date(`${sd}T${st}`);
    const end = new Date(`${ed}T${et}`);
    if (!(start < end)) return setError('Start time must be before end time.');
    onApply({ start, end });
  };

  const row = (label: string, d: string, setD: (v: string) => void, t: string, setT: (v: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="flex gap-2">
        <TextInput type="date" aria-label={`${label} date`} value={d} onChange={(e) => (setD(e.target.value), setError(''))} className="flex-1 px-2.5 font-mono text-[13px]" />
        <TextInput type="time" aria-label={`${label} time`} value={t} onChange={(e) => (setT(e.target.value), setError(''))} className="w-32 px-2.5 font-mono text-[13px]" />
      </div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Custom time range">
      <div className="mt-5 flex flex-col gap-4">
        {row('Start', sd, setSd, st, setSt)}
        {row('End', ed, setEd, et, setEt)}
        <p className="text-xs text-fg-3">The browser keeps the last hour of readings per device.</p>
        {error && (
          <div className="flex items-center gap-2 text-[13px] text-brand-ink">
            <CircleAlert size={16} />
            {error}
          </div>
        )}
      </div>
      <div className="mt-6 flex gap-2.5">
        <Button size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="lg" className="flex-1" onClick={apply}>
          Apply time range
        </Button>
      </div>
    </Modal>
  );
}

function SchemasMenu() {
  const [schemas, setSchemas] = useState<SensorMapping[]>([]);
  const openSheet = useUiStore((s) => s.openSheet);
  return (
    <MenuRoot onOpenChange={(open) => open && setSchemas(getCustomSchemas())}>
      <MenuTrigger asChild>
        <Button>
          Schemas
          <ChevronDown size={14} />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[280px]">
        <MenuLabel>Custom schemas</MenuLabel>
        {schemas.length === 0 && <div className="px-2.5 pt-1.5 pb-2.5 text-[13px] text-fg-3">No custom schemas saved</div>}
        {schemas.map((schema) => (
          <MenuItem key={schema.id} className="py-2" onSelect={() => openSheet({ kind: 'schema', schema })}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{schema.name}</div>
              <div className="truncate text-xs text-fg-3">{schema.description || `${plural(schema.fields.length, 'field')} · ${schema.format}`}</div>
            </div>
            <button
              type="button"
              aria-label={`Delete ${schema.name}`}
              title="Delete schema"
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm('Are you sure you want to delete this schema?')) return;
                deleteCustomSchema(schema.id);
                setSchemas(getCustomSchemas());
                toast(`Deleted schema ${schema.name}`);
              }}
              className="inline-flex size-7 items-center justify-center rounded-[4px] border-0 bg-transparent text-fg-3 hover:bg-control-hover hover:text-brand-ink"
            >
              <Trash2 size={14} />
            </button>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem className="font-semibold" onSelect={() => openSheet({ kind: 'schema' })}>
          <Plus size={14} />
          New schema
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

function StreamList() {
  const subs = useHubStore((s) => s.activeSubscriptions);
  const devices = useTelemetryStore((s) => s.devices);
  const detected = useTelemetryStore((s) => s.detectedSensors);
  const byHub = useDeviceStore((s) => s.byHub);
  const sheet = useUiStore((s) => s.sheet);
  const openSheet = useUiStore((s) => s.openSheet);
  const streamState = useStreamState();
  const live = subs.filter((s) => streamState(s.hubId, s.portId) === 'live').length;

  return (
    <aside className="flex flex-col lg:sticky lg:top-24">
      <div className="flex h-10 items-center justify-between">
        <span className="kicker">Live streams · {live}</span>
        <Button size="xs" onClick={() => openSheet({ kind: 'add-streams' })}>
          <Plus size={14} />
          Add
        </Button>
      </div>
      <div className="mt-2 border-t border-edge">
        {subs.map((sub) => {
          const key = deviceKey(sub.hubId, sub.portId);
          const port = byHub[sub.hubId]?.ports.find((p) => p.port_id === sub.portId);
          const lines = devices.get(key)?.lines;
          const state = streamState(sub.hubId, sub.portId);
          const last = lines?.length ? lines[lines.length - 1].text : state === 'live' ? 'Waiting for data…' : 'Connecting…';
          const active = sheet?.kind === 'terminal' && sheet.key === key;
          return (
            <div
              key={key}
              {...rowAction(() => openSheet({ kind: 'terminal', key }))}
              title="Open serial terminal"
              className={cn('cursor-pointer border-b border-line-soft px-3 py-3.5 hover:bg-hover', active && 'bg-menu')}
            >
              <div className="flex items-center gap-2">
                <Dot tone={state === 'live' ? 'live' : 'warn'} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{detected.get(key) ?? (port ? deviceName(port) : sub.portId)}</span>
                <SquareTerminal size={14} className="text-fg-3" />
              </div>
              <div className="mt-1 pl-4 font-mono text-xs leading-4 text-fg-3">
                {sub.hubId} · {port ? shortPath(port.port) : sub.portId}
              </div>
              <div className="mt-1.5 truncate pl-4 font-mono text-xs leading-4 text-fg-2">{last}</div>
            </div>
          );
        })}
        {subs.length === 0 && (
          <div className="px-3 py-5 text-[13px] text-fg-3">Nothing is streaming. Add a device to see its serial output and charts here.</div>
        )}
      </div>
    </aside>
  );
}

export function Telemetry() {
  const now = useNow(1000);
  const subs = useHubStore((s) => s.activeSubscriptions);
  const devices = useTelemetryStore((s) => s.devices);
  const layout = useTelemetryStore((s) => s.layout);
  const setLayout = useTelemetryStore((s) => s.setLayout);
  const openSheet = useUiStore((s) => s.openSheet);

  const [win, setWin] = useState<TimeWindow>('15m');
  const [custom, setCustom] = useState<CustomTimeRange | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; over: string | null; merge: boolean } | null>(null);

  const minutes = WINDOWS.find((w) => w.value === win)?.minutes ?? 15;
  const from = win === 'custom' && custom ? custom.start.getTime() : now - minutes * 60 * 1000;
  const to = win === 'custom' && custom ? custom.end.getTime() : now;

  // Devices with a detected sensor get a chart; merged charts replace their sources
  const subscribed = new Set(subs.map((s) => deviceKey(s.hubId, s.portId)));
  const charted = Array.from(subscribed).filter((k) => (devices.get(k)?.chartData.fields.length ?? 0) > 0);
  const merged = layout.merged.filter((m) => m.keys.filter((k) => subscribed.has(k)).length > 1);
  const inMerge = new Set(merged.flatMap((m) => m.keys));
  const ids = [...charted.filter((k) => !inMerge.has(k)), ...merged.map((m) => m.id)];
  const ordered = [...layout.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !layout.order.includes(id))];
  const keysOf = (id: string) => merged.find((m) => m.id === id)?.keys.filter((k) => subscribed.has(k)) ?? [id];

  const reorder = (src: string, dst: string) => {
    const rest = ordered.filter((id) => id !== src);
    const at = rest.indexOf(dst) + (ordered.indexOf(src) < ordered.indexOf(dst) ? 1 : 0);
    rest.splice(at, 0, src);
    setLayout({ ...layout, order: rest });
  };

  const merge = (src: string, dst: string) => {
    const id = `merged-${crypto.randomUUID()}`;
    const keys = [...keysOf(dst), ...keysOf(src)];
    setLayout({
      merged: [...layout.merged.filter((m) => m.id !== src && m.id !== dst), { id, keys }],
      order: ordered.filter((x) => x !== src).map((x) => (x === dst ? id : x)),
    });
  };

  const separate = (id: string) => {
    const m = merged.find((x) => x.id === id);
    if (!m) return;
    const i = ordered.indexOf(id);
    setLayout({
      merged: layout.merged.filter((x) => x.id !== id),
      order: [...ordered.slice(0, i), ...m.keys, ...ordered.slice(i + 1)],
    });
  };

  const dragHandlers = (id: string) => ({
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDrag({ id, over: null, merge: false });
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!drag || drag.id === id) return;
      e.preventDefault();
      if (drag.over !== id || drag.merge !== e.shiftKey) setDrag({ ...drag, over: id, merge: e.shiftKey });
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (drag && drag.id !== id) {
        if (e.shiftKey) merge(drag.id, id);
        else reorder(drag.id, id);
      }
      setDrag(null);
    },
    onDragEnd: () => setDrag(null),
  });

  const panels = ordered.map((id) => {
    const isMerged = id.startsWith('merged-');
    const keys = keysOf(id);
    const series: Series[] = [];
    for (const key of keys) {
      const data = devices.get(key)?.chartData;
      if (!data) continue;
      for (const field of data.fields) {
        series.push({
          key,
          name: field.fieldName,
          unit: field.unit,
          color: chartColor(field.color),
          source: data.sensorName.split(' ')[0],
          points: field.data.filter((p) => p.timestamp >= from && p.timestamp <= to),
        });
      }
    }
    if (isMerged) series.forEach((s, i) => (s.color = sequenceColor(i)));
    const first = devices.get(keys[0])?.chartData;
    const title = isMerged ? 'Merged chart' : (first?.sensorName ?? id);
    const over = drag && drag.over === id && drag.id !== id;
    return (
      <ChartPanel
        key={id}
        title={title}
        subtitle={keys.join('  +  ')}
        merged={isMerged}
        sourceCount={keys.length}
        series={series}
        from={from}
        to={to}
        fileBase={(isMerged ? `merged_chart_${id}` : `${title}_${id}`).replace(/[^\w.-]+/g, '_')}
        dragging={drag?.id === id}
        dropTarget={over ? (drag.merge ? 'merge' : 'reorder') : 'none'}
        mergeLabel={`Release to merge with ${isMerged ? 'this merged chart' : title.split(' ')[0]}`}
        onSeparate={isMerged ? () => separate(id) : undefined}
        {...dragHandlers(id)}
      />
    );
  });

  const subtitle = subs.length
    ? `${plural(subs.length, 'stream')} · ${win === 'custom' ? 'custom range' : `last ${minutes === 60 ? 'hour' : `${minutes} minutes`}`}`
    : 'Subscribe to a device to see its serial output and charts';

  const openCustom = () => {
    setCustom((c) => c ?? { start: new Date(Date.now() - 30 * 60 * 1000), end: new Date() });
    setRangeOpen(true);
  };

  return (
    <section className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-8 max-lg:grid-cols-1">
      <StreamList />

      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader
          title="Telemetry"
          subtitle={subtitle}
          actions={
            <>
              <Segmented
                label="Time window"
                mono
                value={win}
                onChange={(v) => (v === 'custom' ? openCustom() : (setWin(v), setCustom(null)))}
                options={[...WINDOWS.map((w) => ({ value: w.value as TimeWindow, label: w.value })), { value: 'custom', label: 'Custom' }]}
              />
              {win === 'custom' && custom && (
                <Button className="font-mono text-xs font-normal" onClick={() => setRangeOpen(true)}>
                  <Clock size={14} />
                  {custom.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {clock(custom.start).slice(0, 5)} – {clock(custom.end).slice(0, 5)}
                </Button>
              )}
              <SchemasMenu />
            </>
          }
        />

        {panels.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-[4px] border border-edge bg-panel px-8 py-14 max-sm:px-5">
            <div className="text-2xl leading-[30px] font-extrabold tracking-[-0.02em]">{subs.length ? 'Waiting for sensor data' : 'No live streams'}</div>
            <div className="max-w-[520px] text-[15px] leading-[22px] text-fg-2">
              {subs.length
                ? 'Charts appear as soon as a subscribed device prints a line that matches a sensor format. Open a stream on the left to see its raw serial output.'
                : 'Subscribe to a device and its charts appear here as soon as a sensor header is detected. Define your own line formats under Schemas.'}
            </div>
            {!subs.length && (
              <Button variant="primary" size="lg" onClick={() => openSheet({ kind: 'add-streams' })}>
                Add devices
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[13px] text-fg-3">
              <GripVertical size={14} />
              <span>Drag a chart to reorder. Hold Shift while dropping onto another chart to merge them.</span>
            </div>
            {panels}
          </>
        )}
      </div>

      {rangeOpen && custom && (
        <CustomRangeModal
          open
          initial={custom}
          onClose={() => setRangeOpen(false)}
          onApply={(r) => {
            setCustom(r);
            setWin('custom');
            setRangeOpen(false);
          }}
        />
      )}
    </section>
  );
}
