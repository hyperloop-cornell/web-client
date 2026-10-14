import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Filled dark input; the border turns white on focus. */
export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full min-w-0 rounded-[4px] border-2 border-transparent bg-field px-3 text-sm outline-none focus:border-fg focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  );
}

/** Native select styled like the inputs, with a chevron. Native keeps keyboard and screen reader support for free. */
export function Select({ className, wrapperClassName, children, ...props }: ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <span className={cn('relative block', wrapperClassName)}>
      <select
        className={cn(
          'h-11 w-full min-w-0 cursor-pointer appearance-none rounded-[4px] border-2 border-transparent bg-field pr-9 pl-3 text-sm text-fg outline-none focus:border-fg focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-2" />
    </span>
  );
}

/** Label stacked above its control. */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[13px] font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </label>
  );
}
