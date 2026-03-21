import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type {
  AuthToken,
  LoginCredentials,
  User,
  HubInfo,
  PortInfo,
  ConnectionInfo,
  TelemetryEntry,
  TaskStatusResponse,
} from '@/types';

// Get API base URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('auth_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Authentication API
export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthToken> => {
    // OAuth2 password flow requires form data
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    const response = await api.post<AuthToken>('/auth/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },

  loginViewer: async (): Promise<AuthToken> => {
    const response = await api.post<AuthToken>('/auth/login-viewer');
    return response.data;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await api.get<User>('/auth/me');
    return response.data;
  },
};

// Hubs API
export const hubsApi = {
  getHubs: async (): Promise<HubInfo[]> => {
    const response = await api.get<HubInfo[]>('/api/hubs');
    return response.data;
  },

  getHub: async (hubId: string): Promise<HubInfo> => {
    const response = await api.get<HubInfo>(`/api/hubs/${hubId}`);
    return response.data;
  },

  getPorts: async (hubId: string): Promise<PortInfo[]> => {
    const response = await api.get<any>(`/api/hubs/${hubId}/ports`);
    return (response.data.ports || response.data) as PortInfo[];
  },

  getConnections: async (hubId: string): Promise<ConnectionInfo[]> => {
    const response = await api.get<any>(`/api/hubs/${hubId}/connections`);
    return (response.data.connections || response.data) as ConnectionInfo[];
  },

  getTelemetry: async (hubId: string, limit?: number): Promise<TelemetryEntry[]> => {
    const response = await api.get<any>(
      `/api/hubs/${hubId}/telemetry`,
      {
        params: { limit },
      }
    );
    return (response.data.telemetry || response.data) as TelemetryEntry[];
  },

  sendSerialWrite: async (
    hubId: string,
    portId: string,
    data: string,
    priority?: number
  ): Promise<TaskStatusResponse> => {
    const response = await api.post<TaskStatusResponse>(
      `/api/hubs/${hubId}/commands/write`,
      {
        portId: portId,
        data,
        priority,
      }
    );
    return response.data;
  },

  sendFlashCommand: async (
    hubId: string,
    portId: string,
    firmwareData: string,
    priority?: number,
    boardFqbn?: string
  ): Promise<TaskStatusResponse> => {
    const payload: Record<string, any> = {
      portId: portId,
      firmwareData,
      priority,
    };

    if (boardFqbn) {
      payload.boardFqbn = boardFqbn;
    }

    const response = await api.post<TaskStatusResponse>(
      `/api/hubs/${hubId}/commands/flash`,
      payload
    );
    return response.data;
  },

  sendRestartCommand: async (
    hubId: string,
    portId: string,
    priority?: number
  ): Promise<TaskStatusResponse> => {
    const response = await api.post<TaskStatusResponse>(
      `/api/hubs/${hubId}/commands/restart`,
      {
        portId: portId,
        priority,
      }
    );
    return response.data;
  },

  closeConnection: async (
    hubId: string,
    portId: string,
    priority?: number
  ): Promise<{ commandId: string; hubId: string; status: string; message: string }> => {
    const response = await api.post(
      `/api/hubs/${hubId}/commands/close`,
      {
        portId,
        priority: priority ?? 1,
      }
    );
    return response.data;
  },
};

// WebSocket URL helper
export function getWebSocketUrl(token?: string): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = API_BASE_URL.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProtocol}//${wsHost}/ws/client`;
  
  if (token) {
    return `${wsUrl}?token=${encodeURIComponent(token)}`;
  }
  
  return wsUrl;
}

export default api;
