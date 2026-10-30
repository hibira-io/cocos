// A small lobby to start from: shows the room's players and chat in Labels.
// Wire the buttons in the Inspector (Button > Click Events) to join(),
// toggleReady(), send() and start(). Delete this folder when you no longer
// need it; assets/hibira does not depend on it.

import { _decorator, Component, EditBox, Label } from 'cc';
import { HibiraConnection } from '../hibira/HibiraConnection';
import type { Room } from '../hibira/lobby';

const { ccclass, property } = _decorator;

@ccclass('LobbyExample')
export class LobbyExample extends Component {
  @property({ type: EditBox, tooltip: 'Room code to join.' })
  codeInput: EditBox | null = null;

  @property({ type: EditBox, tooltip: 'Chat message to send.' })
  chatInput: EditBox | null = null;

  @property({ type: Label })
  status: Label | null = null;

  @property({ type: Label })
  players: Label | null = null;

  @property({ type: Label })
  chat: Label | null = null;

  room: Room | null = null;

  join() {
    const hibira = HibiraConnection.instance;
    const code = (this.codeInput?.string || 'LOBBY').trim();
    if (!hibira) return this.show('Add a HibiraConnection to the scene.');
    this.room?.leave();
    const room = hibira.joinRoom(code, { capacity: 4 });
    this.room = room;
    this.show(`Joining ${code}...`);
    room.on('ready', () => this.render());
    room.on('members', () => this.render());
    room.on('host', () => this.render());
    room.on('message', () => this.render());
    room.on('full', () => this.show('The room is full.'));
    room.on('kicked', () => this.show('You were removed from the room.'));
    room.on('error', (e) => this.show(e.message));
    room.on('start', (e) => this.show(`Game started by ${e.by}`));
  }

  toggleReady() {
    this.room?.setReady(!this.room.ready);
  }

  send() {
    const text = (this.chatInput?.string || '').trim();
    if (!this.room || !text) return;
    this.room.send(text);
    if (this.chatInput) this.chatInput.string = '';
    this.render();
  }

  start() {
    // Only the host can start, and only when everyone is ready.
    if (this.room?.isHost) this.room.start({ seed: Math.floor(Math.random() * 1e9) }, { requireAllReady: true });
  }

  onDestroy() {
    this.room?.leave();
  }

  private render() {
    const room = this.room;
    if (!room) return;
    this.show(`${room.name}  ${room.players.length}/${room.capacity}${room.isHost ? '  (host)' : ''}`);
    if (this.players) {
      this.players.string = room.players
        .map((p) => `${p.host ? '★' : '·'} ${p.info?.name ?? p.id}${p.ready ? '  ✓' : ''}${p.me ? '  (you)' : ''}`)
        .join('\n');
    }
    if (this.chat) {
      this.chat.string = room.messages
        .slice(-8)
        .map((m) => `${m.info?.name ?? m.from}: ${m.text}`)
        .join('\n');
    }
  }

  private show(text: string) {
    if (this.status) this.status.string = text;
  }
}
