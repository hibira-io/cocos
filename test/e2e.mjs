// A Cocos client (HibiraClient) and a pusher-js client in the same lobby room
// on a real Hibira-compatible server, with server/worker.js as the auth
// endpoint. Needs:
//   HIBIRA_E2E_KEY, HIBIRA_E2E_SECRET, HIBIRA_E2E_HOST
//   (HIBIRA_E2E_PORT, HIBIRA_E2E_TLS=false for a local server)
// npm run test:e2e
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Pusher from 'pusher-js';
import worker from '../server/worker.js';
import { HibiraClient } from './.build/HibiraClient.js';
import { Room } from './.build/lobby.js';

const env = process.env;
const skip = !env.HIBIRA_E2E_KEY || !env.HIBIRA_E2E_SECRET || !env.HIBIRA_E2E_HOST ? 'set HIBIRA_E2E_KEY, HIBIRA_E2E_SECRET and HIBIRA_E2E_HOST' : false;
const tls = env.HIBIRA_E2E_TLS !== 'false';
const port = Number(env.HIBIRA_E2E_PORT || (tls ? 443 : 80));

const until = (fn, what, ms = 5000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(poll, 20);
    };
    poll();
  });

test('cross-play: HibiraClient and pusher-js share a lobby room', { skip }, async () => {
  const auth = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = await worker.fetch(new Request('http://localhost/auth', { method: req.method, body: req.method === 'POST' ? body : undefined }), {
      HIBIRA_APP_KEY: env.HIBIRA_E2E_KEY,
      HIBIRA_APP_SECRET: env.HIBIRA_E2E_SECRET,
    });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(await out.text());
  });
  await new Promise((r) => auth.listen(0, '127.0.0.1', r));
  after(() => auth.close());
  const authEndpoint = `http://127.0.0.1:${auth.address().port}/auth`;
  const code = 'E2E' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const channel = `presence-room-${code}`;

  // The Cocos player joins first, so it is the host.
  const cocos = new HibiraClient(env.HIBIRA_E2E_KEY, {
    host: env.HIBIRA_E2E_HOST,
    port,
    tls,
    authEndpoint,
    authParams: () => ({ user_id: 'cocos-1', name: 'Cocos' }),
  });
  after(() => cocos.disconnect());
  const a = Room.join(cocos, channel, { capacity: 2 });
  await until(() => a.me, 'cocos seated');
  assert.equal(a.isHost, true);

  const web = new Pusher(env.HIBIRA_E2E_KEY, {
    cluster: 'hkg',
    wsHost: env.HIBIRA_E2E_HOST,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ['ws'],
    channelAuthorization: { endpoint: authEndpoint, transport: 'ajax', params: { user_id: 'web-1', name: 'Web' } },
  });
  after(() => web.disconnect());
  const b = Room.join(web, channel, { capacity: 2 });
  await until(() => a.players.length === 2 && b.players.length === 2, 'both seated');
  assert.deepEqual(b.players.map((p) => p.id), ['cocos-1', 'web-1']);
  assert.equal(b.host.id, 'cocos-1');

  // Host settings reach the web player; ready flags and chat go both ways.
  a.setSettings({ mode: 'race' });
  await until(() => b.settings.mode === 'race', 'settings');
  b.setReady(true);
  await until(() => a.players.find((p) => p.id === 'web-1')?.ready, 'web ready');
  a.setReady(true);
  await until(() => b.allReady, 'all ready');
  b.send('hello from the web');
  await until(() => a.messages.some((m) => m.text === 'hello from the web' && m.from === 'web-1'), 'chat to cocos');
  a.send('hello from cocos');
  await until(() => b.messages.some((m) => m.text === 'hello from cocos' && m.info?.name === 'Cocos'), 'chat to web');

  // A game event on the room channel, as a game would send one.
  const taps = [];
  web.channel(channel).bind('client-game-tap', (d, meta) => taps.push([d.n, meta?.user_id]));
  cocos.channel(channel).trigger('client-game-tap', { n: 7 });
  await until(() => taps.length, 'game event');
  assert.deepEqual(taps, [[7, 'cocos-1']]);

  let started;
  b.on('start', (e) => (started = e));
  a.start({ seed: 42 });
  await until(() => started, 'start');
  assert.deepEqual(started.data, { seed: 42 });

  // The host leaves: the web player becomes host.
  a.leave();
  await until(() => b.isHost, 'host handover');
});
