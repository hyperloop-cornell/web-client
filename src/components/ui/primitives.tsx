import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Tone = 'ok' | 'live' | 'warn' | 'off';

const DOT_TONE: Record<Tone, string> = {
  ok: 'bg-ok',
  live: 'bg-live',
  warn: 'bg-warn',
  off: 'bg-fg-4',
};

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOT_TONE[tone], className)} />;
}

/** Live / Connecting / Idle, the three states a device subscription can be in. */
export function StreamState({ state, className }: { state: 'live' | 'pending' | 'idle'; className?: string }) {
  if (state === 'live') {
    return (
      <span className={cn('inline-flex items-center gap-2 text-[13px] font-bold text-brand-ink', className)}>
        <Dot tone="live" />
        Live
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className={cn('inline-flex items-center gap-2 text-[13px] font-semibold text-warn', className)}>
        <span aria-hidden className="inline-block size-2 rounded-full border-2 border-warn" />
        Connecting
      </span>
    );
  }
  return <span className={cn('text-[13px] text-fg-3', className)}>Idle</span>;
}

/** Usage percentage with a thin bar: white, amber from 80 %, red from 90 %. */
export function Meter({ value, size = 'sm', className }: { value: number | null | undefined; size?: 'sm' | 'lg'; className?: string }) {
  const has = value != null && Number.isFinite(value);
  const pct = has ? Math.max(0, Math.min(100, value)) : 0;
  const color = !has ? 'bg-line-strong' : pct >= 90 ? 'bg-live' : pct >= 80 ? 'bg-warn' : 'bg-[#D4D4D4]';
  return (
    <span className={cn('block overflow-hidden rounded-full bg-line', size === 'sm' ? 'h-1' : 'h-1.5', className)}>
      <span className={cn('block h-full', color)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Small square checkbox used in tables and pickers. */
export function CheckBox({
  checked,
  disabled,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.();
      }}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border-[1.5px] p-0 text-black disabled:cursor-not-allowed disabled:opacity-35',
        checked ? 'border-fg bg-fg' : 'border-[#555555] bg-transparent',
        className
      )}
    >
      {checked && <Check size={13} strokeWidth={3} />}
    </button>
  );
}

/** Segmented control: the selected option is white on black. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  mono,
  className,
  label,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  mono?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex gap-0.5 rounded-[4px] bg-field p-[3px]', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-[34px] items-center gap-2 rounded-[3px] border-0 px-3.5 text-[13px] font-semibold transition-colors',
              mono && 'px-3 font-mono text-xs',
              active ? 'bg-fg text-black' : 'bg-transparent text-fg-2 hover:text-fg'
            )}
          >
            {o.label}
            {o.count != null && <span className="font-mono text-xs opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="display">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-[22px] text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** Key/value row used in the hub and device sheets. */
export function Fact({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-panel py-3 text-sm">
      <span className="shrink-0 text-fg-3">{k}</span>
      <span className={cn('text-right [overflow-wrap:anywhere]', mono && 'font-mono text-[13px]')}>{v}</span>
    </div>
  );
}

/** Format chip such as ".hex". */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-[3px] bg-field px-1.5 font-mono text-[11px] leading-[18px] text-fg-2">{children}</span>;
}
