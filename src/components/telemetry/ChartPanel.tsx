import { useRef, type DragEvent } from 'react';
import { Download, GripVertical, Layers, Split } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { clock, plural, reading } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/overlay';

/** One plotted line: a sensor field of one device, already limited to the visible window. */
export interface Series {
  key: string; // hubId:portId
  name: string;
  unit: string;
  color: string;
  source: string; // short sensor name, used to label merged charts
  points: { timestamp: number; value: number }[];
}

/** Max points drawn per line; longer series are thinned evenly. */
const MAX_POINTS = 300;

function niceStep(range: number): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * Math.pow(10, exp);
}

function niceTicks(lo: number, hi: number, count: number) {
  if (hi - lo < 1e-9) {
    hi = lo + 1;
    lo = lo - 1;
  }
  const step = niceStep((hi - lo) / Math.max(1, count - 1));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { min, max, step, ticks };
}

/** SVG paths in a 1000 x 100 box, plus y ticks as percentages from the top. */
function geometry(series: Series[], from: number, to: number) {
  let lo = Infinity;
  let hi = -Infinity;
  const thinned = series.map((s) => {
    const stride = Math.max(1, Math.ceil(s.points.length / MAX_POINTS));
    const pts = s.points.filter((_, i) => i % stride === 0 || i === s.points.length - 1);
    for (const p of pts) {
      if (p.value < lo) lo = p.value;
      if (p.value > hi) hi = p.value;
    }
    return pts;
  });
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const nt = niceTicks(lo - pad, hi + pad, 3);
  const span = nt.max - nt.min || 1;
  const x = (ts: number) => ((ts - from) / (to - from || 1)) * 1000;
  const y = (v: number) => 100 - ((v - nt.min) / span) * 100;
  const decimals = nt.step >= 1 ? 0 : nt.step >= 0.1 ? 1 : 2;
  return {
    paths: thinned.map((pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)} ${y(p.value).toFixed(2)}`).join('')),
    ticks: nt.ticks.map((v) => ({ pct: y(v), label: v.toFixed(decimals) })).filter((t) => t.pct >= -1 && t.pct <= 101),
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(series: Series[], fileBase: string) {
  const stamps = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.timestamp)))).sort((a, b) => a - b);
  const lookups = series.map((s) => new Map(s.points.map((p) => [p.timestamp, p.value])));
  const header = ['Time', ...series.map((s) => `${s.source} ${s.name} (${s.unit})`)].join(',');
  const rows = stamps.map((t) => [new Date(t).toISOString(), ...lookups.map((m) => m.get(t) ?? '')].join(','));
  downloadBlob(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }), `${fileBase}_${Date.now()}.csv`);
}

async function exportImage(element: HTMLElement, format: 'png' | 'jpg' | 'pdf', fileBase: string) {
  const canvas = await html2canvas(element, { backgroundColor: '#0F0F0F', scale: 2 });
  const name = `${fileBase}_${Date.now()}`;
  if (format === 'pdf') {
    const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${name}.pdf`);
    return;
  }
  const a = document.createElement('a');
  a.href = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png');
  a.download = `${name}.${format}`;
  a.click();
}

export interface ChartPanelProps {
  title: string;
  subtitle: string;
  merged: boolean;
  sourceCount: number;
  series: Series[];
  from: number;
  to: number;
  fileBase: string;
  /** Drag state from the page */
  dragging: boolean;
  dropTarget: 'none' | 'reorder' | 'merge';
  mergeLabel: string;
  onSeparate?: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function ChartPanel(props: ChartPanelProps) {
  const { title, subtitle, merged, sourceCount, series, from, to, fileBase, dragging, dropTarget, mergeLabel, onSeparate } = props;
  const ref = useRef<HTMLDivElement>(null);

  // One row per unit, so values on different scales never share an axis
  const units = Array.from(new Set(series.map((s) => s.unit)));
  const rowHeight = units.length === 1 ? 150 : units.length > 2 ? 76 : 100;
  const hasData = series.some((s) => s.points.length > 1);

  const span = to - from;
  const xLabels = [0, 1, 2, 3, 4].map((i) => {
    const label = clock(from + (span * i) / 4);
    return { pct: i * 25, label: span <= 10 * 60 * 1000 ? label : label.slice(0, 5), align: i === 0 ? 'translate-x-0' : i === 4 ? '-translate-x-full' : '-translate-x-1/2' };
  });

  return (
    <div
      ref={ref}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      className={cn(
        'relative rounded-[4px] border bg-panel transition-opacity',
        dropTarget === 'merge' ? 'border-brand-ink' : dropTarget === 'reorder' ? 'border-fg' : 'border-edge',
        dragging && 'opacity-35'
      )}
    >
      {dropTarget === 'merge' && (
        <div className="absolute -top-[13px] left-1/2 z-[2] -translate-x-1/2 rounded-[3px] bg-brand px-2.5 py-[3px] text-xs font-bold whitespace-nowrap text-white">
          {mergeLabel}
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-line-panel px-4 py-3">
        <GripVertical size={16} className="cursor-grab text-fg-4" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {merged && <Layers size={14} />}
            <span className="truncate text-[15px] font-bold">{title}</span>
            {merged && <span className="rounded-[3px] bg-control px-1.5 text-[11px] font-semibold text-fg-2">{plural(sourceCount, 'source')}</span>}
            {!hasData && <span className="text-xs text-warn">Waiting for sensor data…</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-fg-3">{subtitle}</div>
        </div>
        {merged && onSeparate && (
          <Button size="xs" onClick={onSeparate}>
            <Split size={14} />
            Separate
          </Button>
        )}
        <MenuRoot>
          <MenuTrigger asChild>
            <Button size="xs">
              <Download size={14} />
              Export
            </Button>
          </MenuTrigger>
          <MenuContent className="w-44">
            <MenuItem onSelect={() => exportCsv(series, fileBase)}>Download CSV</MenuItem>
            {(['png', 'jpg', 'pdf'] as const).map((f) => (
              <MenuItem key={f} onSelect={() => ref.current && void exportImage(ref.current, f, fileBase)}>
                Download {f.toUpperCase()}
              </MenuItem>
            ))}
          </MenuContent>
        </MenuRoot>
      </div>

      {units.map((unit) => {
        const rowSeries = series.filter((s) => s.unit === unit);
        const geo = geometry(rowSeries, from, to);
        const single = rowSeries.length === 1;
        // "Temperature", or "Accel" when every line is "Accel X/Y/Z", or "Values in °C"
        const first = rowSeries[0].name.split(' ')[0];
        const shared = !single && !merged && rowSeries.every((s) => s.name.split(' ')[0] === first);
        const label = single ? (merged ? `${rowSeries[0].source} · ${rowSeries[0].name}` : rowSeries[0].name) : shared ? first : `Values in ${unit || 'units'}`;

        return (
          <div key={unit} className="grid grid-cols-[232px_minmax(0,1fr)_64px] border-b border-[#161616] max-md:grid-cols-[150px_minmax(0,1fr)_56px]">
            <div className="flex min-w-0 flex-col gap-1.5 border-r border-[#161616] px-4 py-3.5">
              <div className="kicker truncate">{label}</div>
              {rowSeries.map((s) => {
                const last = s.points.length ? s.points[s.points.length - 1].value : null;
                const itemName = single ? '' : merged ? `${s.source} · ${s.name}` : shared ? s.name.slice(first.length + 1) : s.name;
                return (
                  <div key={`${s.key}-${s.name}`} className="flex items-baseline gap-2">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                    <span className={cn('min-w-0 truncate text-[13px] text-fg-2', single ? 'flex-none' : 'flex-1')}>{itemName}</span>
                    <span
                      className={cn('leading-[1.15] font-bold tracking-[-0.02em] tabular-nums', single ? 'text-[26px]' : 'text-[15px]')}
                    >
                      {reading(last)}
                    </span>
                    <span className="w-[30px] text-xs text-fg-3">{s.unit}</span>
                  </div>
                );
              })}
            </div>
            <div className="relative my-3.5 ml-4" style={{ height: rowHeight }}>
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                {geo.ticks.map((t, i) => (
                  <line key={i} x1={0} x2={1000} y1={t.pct} y2={t.pct} stroke="#1F1F1F" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                {geo.paths.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke={rowSeries[i].color} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            </div>
            <div className="relative my-3.5" style={{ height: rowHeight }}>
              {geo.ticks.map((t, i) => (
                <span key={i} className="absolute left-2.5 -translate-y-1/2 font-mono text-[11px] text-[#6E6E6E]" style={{ top: `${t.pct}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-[232px_minmax(0,1fr)_64px] max-md:grid-cols-[150px_minmax(0,1fr)_56px]">
        <div />
        <div className="relative ml-4 h-[30px]">
          {xLabels.map((x) => (
            <span key={x.pct} className={cn('absolute top-2 font-mono text-[11px] whitespace-nowrap text-[#6E6E6E]', x.align)} style={{ left: `${x.pct}%` }}>
              {x.label}
            </span>
          ))}
        </div>
        <div />
      </div>
    </div>
  );
}
