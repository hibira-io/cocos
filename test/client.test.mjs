// HibiraClient against a fake WebSocket, and the lobby Room on top of it.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeSocket.all.push(this);
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }
  // Test helpers.
  receive(event, data, extra = {}) {
    this.onmessage({ data: JSON.stringify({ event, data: JSON.stringify(data), ...extra }) });
  }
  open(socketId = '1.1') {
    this.receive('pusher:connection_established', { socket_id: socketId, activity_timeout: 120 });
  }
  last(event) {
    return [...this.sent].reverse().find((m) => m.event === event);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
let auths;

beforeEach(() => {
  FakeSocket.all = [];
  auths = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = async (url, init) => {
    const form = new URLSearchParams(init.body);
    auths.push({ url, form: Object.fromEntries(form) });
    const channelData = form.get('channel_name').startsWith('presence-')
      ? JSON.stringify({ user_id: form.get('user_id') || 'me', user_info: { name: 'Me', joined_at: 2 } })
      : undefined;
    return { status: 200, text: async () => JSON.stringify({ auth: 'key:sig', channel_data: channelData }) };
  };
});

const clients = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

const { HibiraClient } = await import('./.build/HibiraClient.js');
const { Room } = await import('./.build/lobby.js');

function client(options = {}) {
  const c = new HibiraClient('app-key', { authEndpoint: 'https://auth.example/auth', ...options });
  clients.push(c);
  return c;
}

test('connects to the Pusher protocol URL', () => {
  client({ host: 'localhost', port: 8080, tls: false });
  assert.match(FakeSocket.all[0].url, /^ws:\/\/localhost:8080\/app\/app-key\?protocol=7&client=hibira-cocos&version=[\d.]+&flash=false$/);
  client();
  assert.match(FakeSocket.all[1].url, /^wss:\/\/ws\.hibira\.io:443\/app\/app-key\?/);
});

test('subscribes public channels once connected and delivers events', () => {
  const c = client();
  const states = [];
  c.connection.bind('state_change', (s) => states.push(s.current));
  const ch = c.subscribe('scores');
  const got = [];
  ch.bind('goal', (d) => got.push(d));
  const ws = FakeSocket.all[0];
  assert.equal(ws.sent.length, 0);
  ws.open();
  assert.equal(c.state, 'connected');
  assert.deepEqual(ws.last('pusher:subscribe').data, { channel: 'scores' });
  ws.receive('pusher_internal:subscription_succeeded', {}, { channel: 'scores' });
  assert.equal(ch.subscribed, true);
  ws.receive('goal', { team: 'home' }, { channel: 'scores' });
  assert.deepEqual(got, [{ team: 'home' }]);
  assert.deepEqual(states, ['connected']);
});

test('signs private channels through the auth endpoint with extra params', async () => {
  const c = client({ authParams: () => ({ user_id: 'u1', name: 'Ann' }) });
  const ws = FakeSocket.all[0];
  ws.open('12.34');
  c.subscribe('private-x');
  await tick();
  assert.deepEqual(auths[0].form, { socket_id: '12.34', channel_name: 'private-x', user_id: 'u1', name: 'Ann' });
  assert.deepEqual(ws.last('pusher:subscribe').data, { channel: 'private-x', auth: 'key:sig' });
});

test('reports auth failures as subscription errors', async () => {
  globalThis.fetch = async () => ({ status: 403, text: async () => '{"error":"room full"}' });
  const c = client();
  FakeSocket.all[0].open();
  const errors = [];
  c.subscribe('private-x').bind('pusher:subscription_error', (e) => errors.push(e));
  await tick();
  assert.equal(errors[0].status, 403);
  assert.equal(FakeSocket.all[0].last('pusher:subscribe'), undefined);
});

test('client events: only client-* on private or presence channels after subscribing', async () => {
  const c = client();
  const ws = FakeSocket.all[0];
  ws.open();
  const pub = c.subscribe('public');
  ws.receive('pusher_internal:subscription_succeeded', {}, { channel: 'public' });
  assert.equal(pub.trigger('client-a', {}), false);
  const priv = c.subscribe('private-p');
  assert.equal(priv.trigger('client-a', {}), false);
  await tick();
  ws.receive('pusher_internal:subscription_succeeded', {}, { channel: 'private-p' });
  assert.equal(priv.trigger('a', {}), false);
  assert.equal(priv.trigger('client-a', { n: 1 }), true);
  assert.deepEqual(ws.last('client-a'), { event: 'client-a', channel: 'private-p', data: { n: 1 } });
});

test('presence members and user_id on client events', async () => {
  const c = client({ authParams: () => ({ user_id: 'me' }) });
  const ws = FakeSocket.all[0];
  ws.open();
  const ch = c.subscribe('presence-room-A');
  await tick();
  let ok;
  ch.bind('pusher:subscription_succeeded', (m) => (ok = m));
  ws.receive('pusher_internal:subscription_succeeded', { presence: { ids: ['me', 'b'], hash: { me: { name: 'Me' }, b: { name: 'B' } }, count: 2 } }, { channel: 'presence-room-A' });
  assert.equal(ok.count, 2);
  assert.equal(ok.myID, 'me');
  assert.deepEqual(ok.me, { id: 'me', info: { name: 'Me' } });
  const events = [];
  ch.bind('pusher:member_added', (m) => events.push(['add', m.id]));
  ch.bind('pusher:member_removed', (m) => events.push(['remove', m.id, m.info.name]));
  ws.receive('pusher_internal:member_added', { user_id: 'c', user_info: { name: 'C' } }, { channel: 'presence-room-A' });
  ws.receive('pusher_internal:member_added', { user_id: 'c', user_info: { name: 'C' } }, { channel: 'presence-room-A' });
  ws.receive('pusher_internal:member_removed', { user_id: 'b' }, { channel: 'presence-room-A' });
  assert.deepEqual(events, [['add', 'c'], ['remove', 'b', 'B']]);
  assert.equal(ch.members.count, 2);
  let meta;
  ch.bind('client-x', (d, m) => (meta = m));
  ws.receive('client-x', {}, { channel: 'presence-room-A', user_id: 'c' });
  assert.deepEqual(meta, { user_id: 'c' });
});

test('answers pings and resubscribes after a reconnect', async () => {
  const c = client({ maxReconnectDelay: 0.01 });
  let ws = FakeSocket.all[0];
  ws.open('1.1');
  c.subscribe('scores');
  ws.receive('pusher:ping', {});
  assert.ok(ws.last('pusher:pong'));
  ws.close();
  await tick();
  assert.equal(c.state, 'unavailable');
  await new Promise((r) => setTimeout(r, 30));
  ws = FakeSocket.all[1];
  assert.ok(ws, 'reconnected');
  ws.open('2.2');
  assert.deepEqual(ws.last('pusher:subscribe').data, { channel: 'scores' });
});

test('does not reconnect after a 4000-4099 error or disconnect()', async () => {
  const c = client({ maxReconnectDelay: 0.01 });
  const ws = FakeSocket.all[0];
  ws.receive('pusher:error', { code: 4001, message: 'App key not found' });
  ws.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(FakeSocket.all.length, 1);
  assert.equal(c.state, 'disconnected');
  const c2 = client({ maxReconnectDelay: 0.01 });
  FakeSocket.all[1].open();
  c2.disconnect();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(FakeSocket.all.length, 2);
  assert.equal(c2.state, 'disconnected');
});

test('lobby Room runs on HibiraClient', async () => {
  const c = client({ authParams: () => ({ user_id: 'me' }) });
  const ws = FakeSocket.all[0];
  ws.open();
  const room = Room.join(c, 'presence-room-ABCD', { capacity: 2 });
  await tick();
  let ready;
  room.on('ready', (e) => (ready = e));
  ws.receive(
    'pusher_internal:subscription_succeeded',
    { presence: { ids: ['host', 'me'], hash: { host: { name: 'Host', joined_at: 1 }, me: { name: 'Me', joined_at: 2 } } } },
    { channel: 'presence-room-ABCD' },
  );
  assert.deepEqual(ready.players.map((p) => p.id), ['host', 'me']);
  assert.equal(room.isHost, false);
  room.setReady(true);
  assert.deepEqual(ws.last('client-lobby-ready').data, { ready: true });
  const messages = [];
  room.on('message', (m) => messages.push(m));
  ws.receive('client-lobby-chat', { id: 'm1', text: 'hi', at: 1 }, { channel: 'presence-room-ABCD', user_id: 'host' });
  assert.equal(messages[0].text, 'hi');
  assert.equal(messages[0].info.name, 'Host');
  ws.receive('pusher_internal:member_removed', { user_id: 'host' }, { channel: 'presence-room-ABCD' });
  assert.equal(room.isHost, true);
  room.leave();
  assert.deepEqual(ws.last('pusher:unsubscribe').data, { channel: 'presence-room-ABCD' });
});
