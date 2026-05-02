import { create } from 'zustand';
import { hubsApi } from '@/services/api';
import type { HubInfo, ActiveSubscription, Task } from '@/types';

interface HubState {
  hubs: HubInfo[];
  activeSubscriptions: ActiveSubscription[];
  selectedDevices: Set<string>; // Set of "hubId:portId" strings
  tasks: Task[]; // Active command tasks
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchHubs: () => Promise<void>;
  updateHub: (hub: HubInfo) => void;
  addSubscription: (subscription: ActiveSubscription) => void;
  removeSubscription: (hubId: string, portId: string) => void;
  toggleDeviceSelection: (hubId: string, portId: string) => void;
  clearDeviceSelection: () => void;
  getSelectedDevices: () => ActiveSubscription[];
  
  // Task management
  addTask: (task: Task) => void;
  updateTaskStatus: (update: { task_id: string; status: Task['status']; result?: unknown; error?: string }) => void;
  removeTask: (taskId: string) => void;
  getActiveTaskForPort: (portId: string) => Task | undefined;
  cleanupCompletedTasks: () => void;
}

function deviceKey(hubId: string, portId: string): string {
  return `${hubId}:${portId}`;
}

export const useHubStore = create<HubState>((set, get) => ({
  hubs: [],
  activeSubscriptions: [],
  selectedDevices: new Set(),
  tasks: [],
  isLoading: false,
  error: null,

  fetchHubs: async () => {
    set({ isLoading: true, error: null });
    try {
      const hubs = await hubsApi.getHubs();
      set({ hubs: hubs ?? [], isLoading: false });
    } catch (error: unknown) {
      const errorMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'data' in error.response &&
        typeof error.response.data === 'object' &&
        error.response.data !== null &&
        'detail' in error.response.data &&
        typeof error.response.data.detail === 'string'
          ? error.response.data.detail
          : 'Failed to fetch hubs';
      set({ hubs: [], error: errorMessage, isLoading: false });
    }
  },

  updateHub: (hub: HubInfo) => {
    set((state) => ({
      hubs: state.hubs.map((h) => (h.hubId === hub.hubId ? hub : h)),
    }));
  },

  addSubscription: (subscription: ActiveSubscription) => {
    set((state) => {
      const key = deviceKey(subscription.hubId, subscription.portId);
      const exists = state.activeSubscriptions.some(
        (s) => deviceKey(s.hubId, s.portId) === key
      );

      if (exists) {
        return state;
      }

      return {
        activeSubscriptions: [...state.activeSubscriptions, subscription],
      };
    });
  },

  removeSubscription: (hubId: string, portId: string) => {
    const key = deviceKey(hubId, portId);
    set((state) => ({
      activeSubscriptions: state.activeSubscriptions.filter(
        (s) => deviceKey(s.hubId, s.portId) !== key
      ),
    }));
  },

  toggleDeviceSelection: (hubId: string, portId: string) => {
    const key = deviceKey(hubId, portId);
    set((state) => {
      const newSelection = new Set(state.selectedDevices);
      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }
      return { selectedDevices: newSelection };
    });
  },

  clearDeviceSelection: () => {
    set({ selectedDevices: new Set() });
  },

  getSelectedDevices: () => {
    const state = get();
    const selected: ActiveSubscription[] = [];

    state.selectedDevices.forEach((key) => {
      const [hubId, portId] = key.split(':');
      const subscription = state.activeSubscriptions.find(
        (s) => s.hubId === hubId && s.portId === portId
      );

      if (subscription) {
        selected.push(subscription);
      } else {
        // If not in active subscriptions, create a basic one
        selected.push({ 
          hubId, 
          portId,
          subscribedAt: new Date().toISOString(),
        });
      }
    });

    return selected;
  },

  // Task management actions
  addTask: (task: Task) => {
    set((state) => ({
      tasks: [...state.tasks, task],
    }));
  },

  updateTaskStatus: (update) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.task_id === update.task_id) {
          const updatedTask = { ...task, status: update.status };
          
          if (update.result !== undefined) {
            updatedTask.result = update.result;
          }
          if (update.error !== undefined) {
            updatedTask.error = update.error;
          }
          if (update.status === 'running' && !task.started_at) {
            updatedTask.started_at = new Date().toISOString();
          }
          if ((update.status === 'completed' || update.status === 'failed') && !task.completed_at) {
            updatedTask.completed_at = new Date().toISOString();
          }
          
          return updatedTask;
        }
        return task;
      }),
    }));
  },

  removeTask: (taskId: string) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.task_id !== taskId),
    }));
  },

  getActiveTaskForPort: (portId: string) => {
    const state = get();
    return state.tasks.find(
      (task) =>
        task.port_id === portId &&
        (task.status === 'pending' || task.status === 'running')
    );
  },

  cleanupCompletedTasks: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.status !== 'completed' && task.status !== 'failed'
      ),
    }));
  },
}));
