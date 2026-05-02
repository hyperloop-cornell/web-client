import { create } from 'zustand';
import { authApi } from '@/services/api';
import { webSocketService } from '@/services/websocket';
import type { User, LoginCredentials } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  loginViewer: () => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('auth_token'),
  isAuthenticated: !!localStorage.getItem('auth_token'),
  isLoading: false,
  error: null,

  login: async (credentials: LoginCredentials) => {
    set({ isLoading: true, error: null });
    try {
      const tokenData = await authApi.login(credentials);
      const token = tokenData.access_token;

      // Store token
      localStorage.setItem('auth_token', token);

      // Establish WebSocket connection
      try {
        webSocketService.connect(token);
      } catch (e) {
        console.error('Failed to connect WebSocket after login:', e);
      }

      // Fetch user data
      const user = await authApi.getCurrentUser();

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
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
          : 'Login failed. Please try again.';
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });
      localStorage.removeItem('auth_token');
      throw error;
    }
  },

  loginViewer: async () => {
    set({ isLoading: true, error: null });
    try {
      const tokenData = await authApi.loginViewer();
      const token = tokenData.access_token;

      // Store token
      localStorage.setItem('auth_token', token);

      // Establish WebSocket connection
      try {
        webSocketService.connect(token);
      } catch (e) {
        console.error('Failed to connect WebSocket after viewer login:', e);
      }

      // Fetch user data
      const user = await authApi.getCurrentUser();

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.detail || 'View-only login failed. Please try again.';
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });
      localStorage.removeItem('auth_token');
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');

    // Disconnect WebSocket on logout
    try {
      webSocketService.disconnect();
    } catch (e) {
      console.error('Failed to disconnect WebSocket on logout:', e);
    }

    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ isAuthenticated: false, user: null, token: null });
      return;
    }

    set({ isLoading: true });
    try {
      const user = await authApi.getCurrentUser();

      // Connect WebSocket if token present
      try {
        if (token) {
          webSocketService.connect(token);
        }
      } catch (e) {
        console.error('Failed to connect WebSocket during auth check:', e);
      }

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch {
      localStorage.removeItem('auth_token');
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
