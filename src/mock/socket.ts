import type { DeviceSubscription, WebSocketMessage } from '@/types';
import { HEALTH_INTERVAL_MS, TELEMETRY_INTERVAL_MS } from './fixtures';
import { getServer, type Listener } from './server';

// cloud-services src/websocket/client_endpoint.py PING_INTERVAL
const PING_INTERVAL_MS = 30000;

function subscriptionKey(sub: DeviceSubscription): string {
  return `${sub.hubId}:${sub.portId}`;
}

/**
 * Implements just the slice of the WebSocket API that websocket.ts uses, behaving like the real
 * /ws/client endpoint: sends "connected", acks subscribe/unsubscribe with the full active list,
 * streams telemetry for subscribed ports, broadcasts health and task status, and pings.
 */
class MockSocket implements Listener {
  readonly url: string;
  readyState = 0; // CONNECTING; the OPEN/CLOSED values match the real WebSocket constants

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private readonly subscriptions = new Map<string, DeviceSubscription>();
  private readonly timers: number[] = [];

  constructor(url: string) {
    this.url = url;
    // Open asynchronously, after the caller has assigned its handlers.
    window.setTimeout(() => this.open(), 50);
  }

  private open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;

    const server = getServer();
    server.addListener(this);
    this.timers.push(window.setInterval(() => this.emitTelemetry(), TELEMETRY_INTERVAL_MS));
    this.timers.push(
      window.setInterval(() => this.deliver({ type: 'ping', timestamp: new Date().toISOString() }), PING_INTERVAL_MS)
    );
    this.timers.push(window.setInterval(() => server.healthMessages().forEach((m) => this.deliver(m)), HEALTH_INTERVAL_MS));

    this.onopen?.(new Event('open'));
    this.deliver({ type: 'connected', message: 'Connected to telemetry stream', timestamp: new Date().toISOString() });
    server.healthMessages().forEach((m) => this.deliver(m));
  }

  send(raw: string): void {
    if (this.readyState !== 1) return;

    let message: { type?: string; subscriptions?: DeviceSubscription[] };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'subscribe') {
      for (const sub of message.subscriptions ?? []) this.subscriptions.set(subscriptionKey(sub), sub);
      this.deliver({
        type: 'subscription_status',
        subscriptions: Array.from(this.subscriptions.values()).map((sub) => ({ ...sub, status: 'active' as const })),
        timestamp: new Date().toISOString(),
      });
    } else if (message.type === 'unsubscribe') {
      const requested = message.subscriptions ?? [];
      for (const sub of requested) this.subscriptions.delete(subscriptionKey(sub));
      this.deliver({
        type: 'subscription_status',
        subscriptions: requested.map((sub) => ({ hubId: sub.hubId, portId: sub.portId, status: 'inactive' as const })),
        timestamp: new Date().toISOString(),
      });
    }
    // 'pong' needs no handling.
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;

    this.timers.forEach((timer) => window.clearInterval(timer));
    this.timers.length = 0;
    this.subscriptions.clear();
    getServer().removeListener(this);

    // Real sockets fire "close" asynchronously.
    window.setTimeout(() => this.onclose?.(new CloseEvent('close', { code, reason, wasClean: true })), 0);
  }

  /** Server -> client. */
  deliver(message: WebSocketMessage): void {
    if (this.readyState !== 1) return;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  dropSubscription(hubId: string, portId: string): void {
    this.subscriptions.delete(subscriptionKey({ hubId, portId }));
  }

  private emitTelemetry(): void {
    const server = getServer();
    for (const { hubId, portId } of this.subscriptions.values()) {
      const sample = server.sample(hubId, portId);
      if (!sample) continue;

      const line = `${sample.line}\n`;
      this.deliver({
        type: 'telemetry_stream',
        hubId,
        portId,
        sessionId: sample.sessionId,
        timestamp: new Date().toISOString(),
        data: btoa(line),
        dataSizeBytes: line.length,
      });
    }
  }
}

/** Drop-in replacement for `new WebSocket(url)` (only the members websocket.ts touches exist). */
export function createMockSocket(url: string): WebSocket {
  return new MockSocket(url) as unknown as WebSocket;
}
