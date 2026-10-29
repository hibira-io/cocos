// A component that holds the game's Hibira connection. Add it to a node in
// the first scene and fill in the app key and auth endpoint in the
// Inspector; it stays across scene changes, and any script reaches it with
// HibiraConnection.instance.

import { _decorator, Component, director, sys } from 'cc';
import { HibiraClient, ConnectionState } from './HibiraClient';
import { Room, RoomOptions } from './lobby';

const { ccclass, property } = _decorator;

const PLAYER_KEY = 'hibira.player';

@ccclass('HibiraConnection')
export class HibiraConnection extends Component {
  static instance: HibiraConnection | null = null;

  @property({ tooltip: 'Your app key from the Hibira portal. Never put the app secret in the game.' })
  appKey = '';

  @property({ tooltip: 'ws.hibira.io for the default cluster.' })
  host = 'ws.hibira.io';

  @property({ tooltip: 'URL that signs room subscriptions, such as the Worker in server/worker.js.' })
  authEndpoint = '';

  @property({ tooltip: 'Players past this many in a room are told the room is full. 0: no limit.' })
  capacity = 0;

  @property({ tooltip: 'Keep this node, and the connection, when the scene changes.' })
  persistent = true;

  client: HibiraClient | null = null;

  /** A random player ID kept in local storage, and the name the player picked. */
  player = { id: '', name: 'Player' };

  onLoad() {
    if (HibiraConnection.instance && HibiraConnection.instance !== this) {
      this.node.destroy();
      return;
    }
    HibiraConnection.instance = this;
    if (this.persistent) director.addPersistRootNode(this.node);
    this.player = loadPlayer();
    if (!this.appKey) {
      console.warn('[Hibira] Set the app key on the HibiraConnection component.');
      return;
    }
    this.client = new HibiraClient(this.appKey, {
      host: this.host,
      authEndpoint: this.authEndpoint || undefined,
      authParams: () => ({ user_id: this.player.id, name: this.player.name }),
    });
  }

  onDestroy() {
    if (HibiraConnection.instance !== this) return;
    HibiraConnection.instance = null;
    this.client?.disconnect();
    this.client = null;
  }

  get state(): ConnectionState {
    return this.client?.state ?? 'initialized';
  }

  /** Changes the name other players see from the next room on. */
  setName(name: string) {
    this.player.name = name.trim().slice(0, 20) || 'Player';
    sys.localStorage.setItem(PLAYER_KEY, JSON.stringify(this.player));
  }

  /** Joins presence-room-<code> as a lobby Room (seats, host, ready, chat, start). */
  joinRoom(code: string, options: RoomOptions = {}): Room {
    if (!this.client) throw new Error('HibiraConnection has no app key');
    const opts = options.capacity === undefined && this.capacity > 0 ? { ...options, capacity: this.capacity } : options;
    return Room.join(this.client, `presence-room-${code.toUpperCase()}`, opts);
  }
}

function loadPlayer(): { id: string; name: string } {
  try {
    const saved = JSON.parse(sys.localStorage.getItem(PLAYER_KEY) || 'null');
    if (saved && typeof saved.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(saved.id)) {
      return { id: saved.id, name: typeof saved.name === 'string' ? saved.name : 'Player' };
    }
  } catch {
    // A new player below.
  }
  const player = { id: 'p-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36), name: 'Player' };
  sys.localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  return player;
}
