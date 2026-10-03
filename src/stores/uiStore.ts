import { create } from 'zustand';
import type { SensorMapping } from '@/types';

/** The side sheet currently open. Sheets are global so any page can open any of them. */
export type SheetState =
  | { kind: 'hub'; hubId: string }
  | { kind: 'device'; key: string }
  | { kind: 'terminal'; key: string }
  | { kind: 'add-streams' }
  | { kind: 'schema'; schema?: SensorMapping } // with a schema: view it; without: create one
  | null;

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
}

interface UiState {
  sheet: SheetState;
  toast: Toast | null;
  openSheet: (sheet: NonNullable<SheetState>) => void;
  closeSheet: () => void;
  showToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: () => void;
}

let toastTimer: number | undefined;

export const useUiStore = create<UiState>((set) => ({
  sheet: null,
  toast: null,

  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),

  showToast: (message, tone = 'ok') => {
    window.clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), message, tone } });
    toastTimer = window.setTimeout(() => set({ toast: null }), tone === 'error' ? 6000 : 3000);
  },
  dismissToast: () => {
    window.clearTimeout(toastTimer);
    set({ toast: null });
  },
}));

/** Toasts from outside React (services, socket handlers). */
export const toast = (message: string, tone?: Toast['tone']) => useUiStore.getState().showToast(message, tone);
