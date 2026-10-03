import type { KeyboardEvent } from 'react';

/**
 * Props that make a table row act as a button (click, Enter, Space) without nesting block
 * content inside a <button>. Keys pressed on controls inside the row are left to those controls.
 */
export function rowAction(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
