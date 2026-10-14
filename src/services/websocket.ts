import { getWebSocketUrl } from './api';
import { MOCK_HUBS_ENABLED, createMockSocket } from '@/mock';
import type {
  WebSocketMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  DeviceSubscription,
  PongMessage,
} from '@/types';

type OutboundWebSocketMessage = SubscribeMessage | UnsubscribeMessage | PongMessage;

type MessageHandler = (message: WebSocketMessage) => void;

/** What the header shows: connecting for the first time, live, retrying, or signed out. */
export type CloudStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type StatusListener = (status: CloudStatus) => void;

function subscriptionKey(sub: DeviceSubscription): string {
  return `${sub.hubId}:${sub.portId}`;
}

/**
 * Browser connection to the cloud's /ws/client endpoint.
 *
 * The cloud keeps subscriptions per connection, so this service remembers what the user asked
 * for and re-sends it after every reconnect. It reconnects indefinitely with capped exponential
 * backoff, and immediately when the tab becomes visible again.
 */
class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private readonly baseReconnectDelay = 1000; // 1 second
  private readonly maxReconnectDelay = 30000; // 30 seconds
  private messageHandlers: Set<MessageHandler> = new Set();
  private isIntentionallyClosed = false;
  private token: string | null = null;
  private status: CloudStatus = 'offline';
  private statusListeners: Set<StatusListener> = new Set();

  // Everything the user is subscribed to, keyed by hubId:portId (re-sent on reconnect)
  private subscriptions = new Map<string, DeviceSubscription>();

  // Heartbeat monitoring to detect dead connections
  private lastMessageTime: number = 0;
  private heartbeatInterval: number | null = null;
  private readonly HEARTBEAT_CHECK_INTERVAL = 10000; // Check every 10 seconds
  private readonly MAX_MESSAGE_AGE = 65000; // Reconnect if no message for 65 seconds (2x ping interval + buffer)

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.isConnected() && this.token && !this.isIntentionallyClosed) {
          this.reconnectAttempts = 0;
          this.connect(this.token);
        }
      });
    }
  }

  /**
   * Connect to the WebSocket server
   */
  connect(token: string): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.token = token;
    this.isIntentionallyClosed = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const wsUrl = getWebSocketUrl(token);
      const socket = MOCK_HUBS_ENABLED ? createMockSocket(wsUrl) : new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.lastMessageTime = Date.now();
        this.startHeartbeatMonitoring();

        // The server forgets subscriptions when a connection ends: restore all of them
        if (this.subscriptions.size > 0) {
          this.send({ type: 'subscribe', subscriptions: Array.from(this.subscriptions.values()) });
        }
      };

      socket.onmessage = (event: MessageEvent) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      socket.onerror = (error: Event) => {
        console.error('WebSocket error:', error);
      };

      socket.onclose = (event: CloseEvent) => {
        if (this.ws !== socket) return; // a newer connection replaced this one
        console.log('WebSocket closed:', event.code, event.reason);
        this.ws = null;
        this.stopHeartbeatMonitoring();

        if (!this.isIntentionallyClosed) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server (logout)
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.token = null;
    this.subscriptions.clear();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeatMonitoring();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
    this.setStatus('offline');
  }

  /**
   * Subscribe to device telemetry
   */
  subscribe(hubId: string, portId: string): void;
  subscribe(subscriptions: DeviceSubscription[]): void;
  subscribe(arg1: string | DeviceSubscription[], arg2?: string): void {
    const requested = typeof arg1 === 'string' && arg2 ? [{ hubId: arg1, portId: arg2 }] : Array.isArray(arg1) ? arg1 : null;
    if (!requested) {
      console.error('Invalid subscribe arguments');
      return;
    }

    for (const sub of requested) {
      this.subscriptions.set(subscriptionKey(sub), { hubId: sub.hubId, portId: sub.portId });
    }

    if (this.isConnected()) {
      this.send({ type: 'subscribe', subscriptions: requested });
      return;
    }

    // Sent from onopen once connected
    const token = this.token || localStorage.getItem('auth_token');
    if (token) {
      this.connect(token);
    }
  }

  /**
   * Unsubscribe from device telemetry
   */
  unsubscribe(hubId: string, portId: string): void;
  unsubscribe(subscriptions: DeviceSubscription[]): void;
  unsubscribe(arg1: string | DeviceSubscription[], arg2?: string): void {
    const requested = typeof arg1 === 'string' && arg2 ? [{ hubId: arg1, portId: arg2 }] : Array.isArray(arg1) ? arg1 : null;
    if (!requested) {
      console.error('Invalid unsubscribe arguments');
      return;
    }

    for (const sub of requested) {
      this.subscriptions.delete(subscriptionKey(sub));
    }

    if (this.isConnected()) {
      this.send({ type: 'unsubscribe', subscriptions: requested });
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /** Connection status changes, for the header indicator. Returns an unsubscribe function. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): CloudStatus {
    return this.status;
  }

  private setStatus(status: CloudStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private send(message: OutboundWebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    this.lastMessageTime = Date.now();

    if (message.type === 'ping') {
      this.send({ type: 'pong', timestamp: new Date().toISOString() });
      return; // Don't pass ping messages to handlers
    }

    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  /**
   * Schedule a reconnection attempt with capped exponential backoff (never gives up)
   */
  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed || this.reconnectTimeout) {
      return;
    }

    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.token) {
        this.connect(this.token);
      }
    }, delay);
  }

  private startHeartbeatMonitoring(): void {
    this.stopHeartbeatMonitoring();

    this.heartbeatInterval = window.setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTime;

      if (timeSinceLastMessage > this.MAX_MESSAGE_AGE) {
        console.warn(
          `No messages received for ${Math.round(timeSinceLastMessage / 1000)}s. Connection may be dead. Forcing reconnect...`
        );

        const socket = this.ws;
        this.ws = null;
        this.stopHeartbeatMonitoring();
        socket?.close();
        this.setStatus('reconnecting');

        if (!this.isIntentionallyClosed && this.token) {
          this.scheduleReconnect();
        }
      }
    }, this.HEARTBEAT_CHECK_INTERVAL);
  }

  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  hasPendingSubscription(hubId: string, portId: string): boolean {
    return !this.isConnected() && this.subscriptions.has(subscriptionKey({ hubId, portId }));
  }

  getPendingSubscriptions(): DeviceSubscription[] {
    return this.isConnected() ? [] : Array.from(this.subscriptions.values());
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();
