// The auth endpoint for Cocos games on Hibira, as a Cloudflare Worker (the free
// plan is enough). It signs room subscriptions with your app secret, which
// must never ship inside the game.
//
// Settings (wrangler.toml [vars] and `wrangler secret put HIBIRA_APP_SECRET`):
//   HIBIRA_APP_KEY      your app key
//   HIBIRA_APP_SECRET   your app secret (a secret, not a var)
//   ROOM_PREFIX         default presence-room-, what HibiraConnection.joinRoom uses
//   ALLOWED_ORIGINS     comma-separated origins for web builds, or * (default)
//   ROOM_CAPACITY       optional: refuse players past this many per room;
//                       needs HIBIRA_APP_ID (and HIBIRA_HOST if not ws.hibira.io)

const enc = new TextEncoder();

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Members in a room, from the HTTP API (signed GET). */
async function roomSize(env, channel) {
  const host = env.HIBIRA_HOST || 'ws.hibira.io';
  const path = `/apps/${env.HIBIRA_APP_ID}/channels/${channel}`;
  const params = { auth_key: env.HIBIRA_APP_KEY, auth_timestamp: String(Math.floor(Date.now() / 1000)), auth_version: '1.0', info: 'user_count' };
  const query = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = await hmac(env.HIBIRA_APP_SECRET, `GET\n${path}\n${query}`);
  const scheme = env.HIBIRA_SCHEME || 'https';
  const res = await fetch(`${scheme}://${host}${path}?${query}&auth_signature=${signature}`);
  if (!res.ok) return 0;
  const info = await res.json();
  return info.user_count || 0;
}

function cors(env, request) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : '';
  return allow
    ? { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

function reply(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

export default {
  async fetch(request, env) {
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'POST only' }, headers);
    if (!env.HIBIRA_APP_KEY || !env.HIBIRA_APP_SECRET) return reply(503, { error: 'not configured' }, headers);

    const form = new URLSearchParams(await request.text());
    const socketId = form.get('socket_id') || '';
    const channel = form.get('channel_name') || '';
    const userId = form.get('user_id') || '';
    const name = (form.get('name') || '').trim().slice(0, 20) || 'Player';
    const prefix = env.ROOM_PREFIX || 'presence-room-';

    if (!/^\d+\.\d+$/.test(socketId) || !channel.startsWith(prefix) || !/^[A-Za-z0-9_\-=@,.;]{1,164}$/.test(channel)) {
      return reply(403, { error: 'forbidden' }, headers);
    }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(userId)) return reply(403, { error: 'bad user_id' }, headers);

    const capacity = Number(env.ROOM_CAPACITY || 0);
    if (capacity > 0 && env.HIBIRA_APP_ID && (await roomSize(env, channel)) >= capacity) {
      return reply(403, { error: 'room full' }, headers);
    }

    // This trusts the ID and name the game sends. With your own login,
    // take them from the player's session instead.
    // joined_at orders the room the same way for every player (see lobby.js).
    const channelData = JSON.stringify({ user_id: userId, user_info: { name, joined_at: Date.now() } });
    const signature = await hmac(env.HIBIRA_APP_SECRET, `${socketId}:${channel}:${channelData}`);
    return reply(200, { auth: `${env.HIBIRA_APP_KEY}:${signature}`, channel_data: channelData }, headers);
  },
};

