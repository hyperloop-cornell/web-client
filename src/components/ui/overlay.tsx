import { useRef, type ComponentProps, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Right-hand side sheet. Built on Radix Dialog for focus trapping, Escape and aria wiring.
 * Children are laid out as header / scrolling body / footer with SheetBody and SheetFooter.
 */
export function Sheet({
  open,
  onClose,
  kicker,
  title,
  meta,
  actions,
  width = 480,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          // Never land on a command button (Enter would restart a board): focus the element marked
          // data-autofocus, else Close
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-autofocus]') ?? closeRef.current;
            target?.focus();
          }}
          className="fixed inset-y-0 right-0 z-[61] flex max-w-[100vw] flex-col border-l border-line bg-sheet shadow-[-24px_0_64px_rgba(0,0,0,0.5)] outline-none"
          style={{ width }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-edge px-7 pt-6 pb-5 max-sm:px-5">
            <div className="min-w-0">
              <div className="kicker">{kicker}</div>
              <Dialog.Title className="mt-1.5 text-[30px] leading-[34px] font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]">
                {title}
              </Dialog.Title>
              {meta && <div className="mt-2.5 text-sm">{meta}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              <Dialog.Close asChild>
                <Button ref={closeRef} size="icon-lg" aria-label="Close">
                  <X size={18} />
                </Button>
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-auto px-7 pt-2 pb-7 max-sm:px-5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2.5 border-t border-edge px-7 py-5 max-sm:px-5', className)} {...props} />;
}

/** Centered modal for short forms. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-control-hover bg-sheet p-6 shadow-[0_24px_64px_rgba(0,0,0,0.6)] outline-none"
        >
          <Dialog.Title className="text-2xl leading-[30px] font-extrabold tracking-[-0.02em]">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Dropdown menu on Radix (keyboard navigation, outside click, Escape). */
export const MenuRoot = Menu.Root;
export const MenuTrigger = Menu.Trigger;

export function MenuContent({ className, children, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align="end"
        sideOffset={6}
        className={cn('z-[65] rounded-md border border-control-hover bg-menu p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)] outline-none', className)}
        {...props}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex min-h-[34px] cursor-pointer items-center gap-2 rounded-[4px] px-2.5 text-sm outline-none select-none data-[highlighted]:bg-edge',
        className
      )}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('kicker px-2.5 pt-2 pb-1.5', className)} {...props} />;
}

export function MenuSeparator() {
  return <Menu.Separator className="my-1.5 h-px bg-control-hover" />;
}
