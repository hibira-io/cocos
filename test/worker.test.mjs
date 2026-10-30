// server/worker.js, the auth endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../server/worker.js';

const env = { HIBIRA_APP_KEY: 'key', HIBIRA_APP_SECRET: 'secret' };
const post = (form, e = env, headers = {}) =>
  worker.fetch(new Request('https://auth.example/', { method: 'POST', body: new URLSearchParams(form).toString(), headers }), e);

test('signs a room subscription with joined_at', async () => {
  const before = Date.now();
  const res = await post({ socket_id: '123.456', channel_name: 'presence-room-ABCD', user_id: 'p-1', name: '  Ann  ' });
  assert.equal(res.status, 200);
  const body = await res.json();
  const data = JSON.parse(body.channel_data);
  assert.equal(data.user_id, 'p-1');
  assert.equal(data.user_info.name, 'Ann');
  assert.ok(data.user_info.joined_at >= before);
  const sig = createHmac('sha256', 'secret').update(`123.456:presence-room-ABCD:${body.channel_data}`).digest('hex');
  assert.equal(body.auth, `key:${sig}`);
});

test('refuses other channels, bad socket IDs and bad user IDs', async () => {
  assert.equal((await post({ socket_id: '1.2', channel_name: 'private-admin', user_id: 'p' })).status, 403);
  assert.equal((await post({ socket_id: 'x', channel_name: 'presence-room-A', user_id: 'p' })).status, 403);
  assert.equal((await post({ socket_id: '1.2', channel_name: 'presence-room-A', user_id: 'a b' })).status, 403);
  assert.equal((await post({ socket_id: '1.2', channel_name: 'presence-room-A', user_id: 'p' }, {})).status, 503);
});

test('CORS', async () => {
  const pre = await worker.fetch(new Request('https://auth.example/', { method: 'OPTIONS', headers: { Origin: 'https://game.example' } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  const only = { ...env, ALLOWED_ORIGINS: 'https://game.example' };
  const ok = await post({ socket_id: '1.2', channel_name: 'presence-room-A', user_id: 'p' }, only, { Origin: 'https://game.example' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://game.example');
  const no = await post({ socket_id: '1.2', channel_name: 'presence-room-A', user_id: 'p' }, only, { Origin: 'https://evil.example' });
  assert.equal(no.headers.get('Access-Control-Allow-Origin'), null);
});
