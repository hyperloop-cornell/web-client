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

interface WrappedListResponse<T> {
  ports?: T[];
  connections?: T[];
  telemetry?: T[];
}

interface FlashCommandPayload {
  portId: string;
  firmwareData: string;
  priority?: number;
  boardFqbn?: string;
}

interface CloseConnectionResponseBody {
  commandId: string;
  hubId: string;
  status: string;
  message: string;
}

function extractListResponse<T>(data: T[] | WrappedListResponse<T>, key: keyof WrappedListResponse<T>): T[] {
  if (Array.isArray(data)) {
    return data;
  }

  const value = data[key];
  return Array.isArray(value) ? value : [];
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveApiBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (typeof window === 'undefined') {
    return trimTrailingSlash(configuredBaseUrl || 'http://localhost:8080');
  }

  const pageHostname = window.location.hostname;
  const pageOrigin = window.location.origin;

  if (!configuredBaseUrl) {
    return isLocalHostname(pageHostname) ? 'http://localhost:8080' : pageOrigin;
  }

  try {
    const configuredUrl = new URL(configuredBaseUrl, pageOrigin);

    // Guard against accidentally shipping localhost API config to non-local clients.
    if (!isLocalHostname(pageHostname) && isLocalHostname(configuredUrl.hostname)) {
      return pageOrigin;
    }

    return trimTrailingSlash(configuredUrl.toString());
  } catch {
    return trimTrailingSlash(configuredBaseUrl);
  }
}

const API_BASE_URL = resolveApiBaseUrl();

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
    const response = await api.get<PortInfo[] | WrappedListResponse<PortInfo>>(`/api/hubs/${hubId}/ports`);
    return extractListResponse(response.data, 'ports');
  },

  getConnections: async (hubId: string): Promise<ConnectionInfo[]> => {
    const response = await api.get<ConnectionInfo[] | WrappedListResponse<ConnectionInfo>>(`/api/hubs/${hubId}/connections`);
    return extractListResponse(response.data, 'connections');
  },

  getTelemetry: async (hubId: string, limit?: number): Promise<TelemetryEntry[]> => {
    const response = await api.get<TelemetryEntry[] | WrappedListResponse<TelemetryEntry>>(
      `/api/hubs/${hubId}/telemetry`,
      {
        params: { limit },
      }
    );
    return extractListResponse(response.data, 'telemetry');
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
    const payload: FlashCommandPayload = {
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
  ): Promise<CloseConnectionResponseBody> => {
    const response = await api.post<CloseConnectionResponseBody>(
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
  // Use dedicated WebSocket URL if provided, otherwise derive from API base URL
  let wsUrl: string;
  
  if (import.meta.env.VITE_WS_URL) {
    // If explicit WebSocket URL is set, use it
    wsUrl = import.meta.env.VITE_WS_URL;
  } else {
    // Otherwise derive from API base URL
    const apiUrl = new URL(API_BASE_URL, window.location.origin);
    const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsProtocol}//${apiUrl.host}/ws/client`;
  }
  
  if (token) {
    // Avoid double query params
    const separator = wsUrl.includes('?') ? '&' : '?';
    return `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
  }
  
  return wsUrl;
}

export default api;
