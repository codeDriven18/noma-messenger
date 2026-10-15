import type { ServerEvent } from '../api/types';

type Handler = (event: ServerEvent) => void;
type Status = 'connecting' | 'online' | 'offline';

/** Self-healing WebSocket with exponential back-off and keep-alive pings. */
class RealtimeSocket {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(s: Status) => void>();
  private retry = 0;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  status: Status = 'offline';

  connect(token: string) {
    this.token = token;
    this.open();
  }

  private setStatus(s: Status) {
    this.status = s;
    this.statusHandlers.forEach((h) => h(s));
  }

  private open() {
    if (!this.token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    window.clearTimeout(this.reconnectTimer);
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('online');
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      let data: ServerEvent;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers.forEach((h) => {
        try {
          h(data);
        } catch (err) {
          console.error('socket handler failed', err);
        }
      });
    };
    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('offline');
      if (e.code === 4401 || !this.token) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry) + Math.random() * 400;
      this.retry += 1;
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  /** Reconnect immediately (e.g. when the tab regains focus / network). */
  nudge() {
    if (this.token && !this.ws) {
      this.retry = 0;
      this.open();
    }
  }

  send(payload: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  on(handler: Handler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: (s: Status) => void) {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  close() {
    this.token = null;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('offline');
  }
}

export const socket = new RealtimeSocket();

window.addEventListener('online', () => socket.nudge());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) socket.nudge();
});
