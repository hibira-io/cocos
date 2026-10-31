// A Pusher Channels protocol client for Cocos Creator, with no dependencies.
//
// It needs only the WebSocket and XMLHttpRequest (or fetch) globals, which
// Cocos provides on web, native (iOS, Android, Windows, macOS) and
// mini-game platforms, so one client works everywhere a Cocos game runs.
// The API is the part of pusher-js that games use, so @hibira-io/lobby's
// Room (./lobby) runs on it unchanged.

export interface HibiraOptions {
  /** Default ws.hibira.io. */
  host?: string;
  /** Default 443 with TLS, 80 without. */
  port?: number;
  /** Default true (wss://). */
  tls?: boolean;
  /** URL that signs private- and presence- subscriptions. */
  authEndpoint?: string;
  /** Extra form fields for the auth request, such as the player's ID and name. */
  authParams?: () => Record<string, string>;
  /** Extra headers for the auth request. */
  authHeaders?: () => Record<string, string>;
  /** Seconds between reconnect attempts grow from 1 to this. Default 10. */
  maxReconnectDelay?: number;
}

export type ConnectionState = 'initialized' | 'connecting' | 'connected' | 'unavailable' | 'disconnected';

type Handler = (data: any, meta?: { user_id?: string }) => void;

const VERSION = '0.2.1';

class Emitter {
  private handlers = new Map<string, Handler[]>();

  bind(event: string, fn: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  unbind(event?: string, fn?: Handler): this {
    if (event === undefined) this.handlers.clear();
    else if (!fn) this.handlers.delete(event);
    else this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== fn));
    return this;
  }

  emit(event: string, data?: any, meta?: { user_id?: string }) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) {
      try {
        fn(data, meta);
      } catch (err) {
        console.error(`[Hibira] handler for ${event} failed`, err);
      }
    }
  }
}

/** A presence channel's members, shaped like pusher-js's. */
export class Members {
  members: Record<string, any> = {};
  count = 0;
  myID: string | null = null;
  me: { id: string; info: any } | null = null;

  get(id: string): { id: string; info: any } | null {
    return id in this.members ? { id, info: this.members[id] } : null;
  }

  each(fn: (member: { id: string; info: any }) => void) {
    for (const id of Object.keys(this.members)) fn({ id, info: this.members[id] });
  }

  /** @internal */
  _set(presence: { ids?: string[]; hash?: Record<string, any> }, myID: string | null) {
    this.members = { ...(presence.hash ?? {}) };
    for (const id of presence.ids ?? []) if (!(id in this.members)) this.members[id] = null;
    this.count = Object.keys(this.members).length;
    this.myID = myID;
    this.me = myID !== null ? { id: myID, info: this.members[myID] ?? null } : null;
  }

  /** @internal */
  _add(id: string, info: any): boolean {
    const isNew = !(id in this.members);
    this.members[id] = info;
    if (isNew) this.count++;
    return isNew;
  }

  /** @internal */
  _remove(id: string): boolean {
    if (!(id in this.members)) return false;
    delete this.members[id];
    this.count--;
    return true;
  }
}

export class Channel extends Emitter {
  subscribed = false;
  subscriptionPending = false;
  /** Set on presence- channels. */
  members: Members | null;
  /** @internal */ _userId: string | null = null;

  constructor(readonly name: string, private client: HibiraClient) {
    super();
    this.members = name.startsWith('presence-') ? new Members() : null;
  }

  /** Sends a client event (client-*) on a private or presence channel. False when it cannot be sent. */
  trigger(event: string, data: unknown): boolean {
    if (!event.startsWith('client-') || !this.subscribed || this.name.indexOf('private-') !== 0 && this.name.indexOf('presence-') !== 0) {
      return false;
    }
    return this.client._send({ event, channel: this.name, data });
  }
}

/**
 * The connection. Create one per game:
 *
 *     const hibira = new HibiraClient('app-key', { authEndpoint: 'https://.../auth' });
 *     hibira.subscribe('scores').bind('goal', (data) => ...);
 */
export class HibiraClient {
  readonly connection = new Emitter() as Emitter & { state: ConnectionState };
  socketId: string | null = null;
  private ws: WebSocket | null = null;
  private channels = new Map<string, Channel>();
  private readonly url: string;
  private activityTimeout = 120;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUser = false;

  constructor(readonly key: string, readonly options: HibiraOptions = {}) {
    const tls = options.tls ?? true;
    const port = options.port ?? (tls ? 443 : 80);
    const host = options.host ?? 'ws.hibira.io';
    this.url = `${tls ? 'wss' : 'ws'}://${host}:${port}/app/${encodeURIComponent(key)}?protocol=7&client=hibira-cocos&version=${VERSION}&flash=false`;
    this.connection.state = 'initialized';
    this.connect();
  }

  get state(): ConnectionState {
    return this.connection.state;
  }

  connect() {
    if (this.ws) return;
    this.closedByUser = false;
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (e: MessageEvent) => this.onMessage(String(e.data));
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {
      // onclose follows and reconnects.
    };
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.onClose(this.ws);
  }

  subscribe(name: string): Channel {
    let channel = this.channels.get(name);
    if (!channel) {
      channel = new Channel(name, this);
      this.channels.set(name, channel);
    }
    if (this.state === 'connected' && !channel.subscribed && !channel.subscriptionPending) this.subscribeOnServer(channel);
    return channel;
  }

  unsubscribe(name: string) {
    const channel = this.channels.get(name);
    if (!channel) return;
    this.channels.delete(name);
    if (channel.subscribed || channel.subscriptionPending) this._send({ event: 'pusher:unsubscribe', data: { channel: name } });
    channel.subscribed = false;
    channel.subscriptionPending = false;
  }

  channel(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  /** Listens on every subscribed channel. */
  bind_global(fn: (event: string, data: any) => void) {
    this.globalHandlers.push(fn);
  }

  private globalHandlers: ((event: string, data: any) => void)[] = [];

  /** @internal */
  _send(message: { event: string; channel?: string; data: unknown }): boolean {
    if (!this.ws || this.state !== 'connected') return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private setState(state: ConnectionState) {
    const previous = this.connection.state;
    if (previous === state) return;
    this.connection.state = state;
    this.connection.emit('state_change', { previous, current: state });
    this.connection.emit(state);
  }

  private onMessage(text: string) {
    this.resetActivity();
    let msg: { event: string; channel?: string; data?: any; user_id?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    let data = msg.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // Plain string data.
      }
    }
    switch (msg.event) {
      case 'pusher:connection_established':
        this.socketId = data.socket_id;
        this.activityTimeout = Math.min(Number(data.activity_timeout) || 120, 120);
        this.attempts = 0;
        this.setState('connected');
        for (const channel of this.channels.values()) {
          channel.subscribed = false;
          channel.subscriptionPending = false;
          this.subscribeOnServer(channel);
        }
        this.resetActivity();
        return;
      case 'pusher:ping':
        this._send({ event: 'pusher:pong', data: {} });
        return;
      case 'pusher:pong':
        return;
      case 'pusher:error':
        this.connection.emit('error', data);
        // 4000-4099: do not reconnect (wrong key, app disabled, over quota).
        if (data && data.code >= 4000 && data.code < 4100) this.closedByUser = true;
        return;
    }
    const channel = msg.channel ? this.channels.get(msg.channel) : undefined;
    if (!channel) return;
    switch (msg.event) {
      case 'pusher_internal:subscription_succeeded':
        channel.subscribed = true;
        channel.subscriptionPending = false;
        if (channel.members) {
          channel.members._set(data?.presence ?? {}, channel._userId);
          channel.emit('pusher:subscription_succeeded', channel.members);
        } else {
          channel.emit('pusher:subscription_succeeded', data);
        }
        return;
      case 'pusher_internal:member_added':
        if (channel.members && channel.members._add(String(data.user_id), data.user_info ?? null)) {
          channel.emit('pusher:member_added', { id: String(data.user_id), info: data.user_info ?? null });
        }
        return;
      case 'pusher_internal:member_removed': {
        const id = String(data.user_id);
        const info = channel.members?.members[id];
        if (channel.members && channel.members._remove(id)) channel.emit('pusher:member_removed', { id, info });
        return;
      }
    }
    const meta = msg.user_id !== undefined ? { user_id: msg.user_id } : {};
    channel.emit(msg.event, data, meta);
    for (const fn of this.globalHandlers) fn(msg.event, data);
  }

  private subscribeOnServer(channel: Channel) {
    channel.subscriptionPending = true;
    const name = channel.name;
    if (!name.startsWith('private-') && !name.startsWith('presence-')) {
      this._send({ event: 'pusher:subscribe', data: { channel: name } });
      return;
    }
    const socketId = this.socketId!;
    this.authorize(name, socketId).then(
      (auth) => {
        // Gone, or the connection changed while the auth request ran.
        if (this.channels.get(name) !== channel || this.socketId !== socketId) return;
        if (auth.channel_data) {
          try {
            channel._userId = String(JSON.parse(auth.channel_data).user_id);
          } catch {
            channel._userId = null;
          }
        }
        this._send({ event: 'pusher:subscribe', data: { channel: name, auth: auth.auth, channel_data: auth.channel_data } });
      },
      (err: { status: number; error: string }) => {
        channel.subscriptionPending = false;
        channel.emit('pusher:subscription_error', { type: 'AuthError', status: err.status, error: err.error });
      },
    );
  }

  private authorize(channel: string, socketId: string): Promise<{ auth: string; channel_data?: string }> {
    const endpoint = this.options.authEndpoint;
    if (!endpoint) return Promise.reject({ status: 0, error: 'no authEndpoint for ' + channel });
    const params: Record<string, string> = { socket_id: socketId, channel_name: channel, ...(this.options.authParams?.() ?? {}) };
    const body = Object.keys(params)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', ...(this.options.authHeaders?.() ?? {}) };
    return post(endpoint, body, headers).then(({ status, text }) => {
      if (status !== 200) return Promise.reject({ status, error: text.slice(0, 200) });
      try {
        return JSON.parse(text);
      } catch {
        return Promise.reject({ status, error: 'auth endpoint did not answer JSON' });
      }
    });
  }

  private resetActivity() {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
    if (this.state !== 'connected') return;
    // Quiet for activity_timeout: ping, and reconnect when no answer comes.
    this.activityTimer = setTimeout(() => {
      this._send({ event: 'pusher:ping', data: {} });
      this.pongTimer = setTimeout(() => this.ws?.close(), 30000);
    }, this.activityTimeout * 1000);
  }

  private onClose(ws: WebSocket | null) {
    if (ws !== this.ws) return;
    this.ws = null;
    this.socketId = null;
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    for (const channel of this.channels.values()) {
      channel.subscribed = false;
      channel.subscriptionPending = false;
    }
    if (this.closedByUser) {
      this.setState('disconnected');
      return;
    }
    this.setState('unavailable');
    const delay = Math.min(1000 * 2 ** this.attempts, (this.options.maxReconnectDelay ?? 10) * 1000);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

function post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  // XMLHttpRequest first: Cocos native builds have it, and not always fetch.
  if (typeof XMLHttpRequest !== 'undefined') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      for (const k of Object.keys(headers)) xhr.setRequestHeader(k, headers[k]);
      xhr.onload = () => resolve({ status: xhr.status, text: String(xhr.responseText ?? '') });
      xhr.onerror = () => reject({ status: 0, error: 'auth request failed' });
      xhr.send(body);
    });
  }
  return fetch(url, { method: 'POST', body, headers }).then(
    async (r) => ({ status: r.status, text: await r.text() }),
    () => Promise.reject({ status: 0, error: 'auth request failed' }),
  );
}
