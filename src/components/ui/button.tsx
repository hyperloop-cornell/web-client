import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[4px] border-0 transition-colors [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** Cornell red: the one main action on a screen */
        primary:
          'bg-brand font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-control disabled:text-fg-3',
        /** Dark grey: everything else */
        secondary: 'bg-control font-semibold text-fg hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50',
        /** Text-only until hovered */
        ghost:
          'bg-transparent font-semibold text-fg-2 hover:bg-control hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        /** White: per-row call to action (Subscribe) */
        light:
          'bg-fg font-bold text-black hover:bg-white disabled:cursor-not-allowed disabled:bg-control disabled:text-fg-3',
        danger: 'bg-transparent font-semibold text-brand-ink hover:bg-control',
      },
      size: {
        xs: 'h-8 px-3 text-[13px]',
        sm: 'h-9 px-3.5 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-5 text-[15px]',
        xl: 'h-[52px] px-6 text-base',
        icon: 'size-8 p-0',
        'icon-lg': 'size-9 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
