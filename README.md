# Hibira for Cocos Creator

[![ci](https://github.com/hibira-io/cocos/actions/workflows/ci.yml/badge.svg)](https://github.com/hibira-io/cocos/actions/workflows/ci.yml)

[中文](#中文) · English

Realtime multiplayer for Cocos Creator 3.x games on
[Hibira](https://hibira.io/?utm_source=github&utm_medium=readme&utm_campaign=plugins),
a hosted realtime service that speaks the Pusher Channels protocol.

- **`HibiraClient`**: a Pusher protocol client with no dependencies. It only
  needs `WebSocket` and `XMLHttpRequest`, which Cocos provides on web,
  native (iOS, Android, Windows, macOS) and mini-game builds.
- **Room lobby**: seats, host, ready flags, room settings, kick, start and
  room chat on a presence channel, with no game server. It is
  [@hibira-io/lobby](https://github.com/hibira-io/lobby-js), so Cocos players
  can share rooms with web players who use pusher-js.
- **Matchmaking queue**: `Queue` from the same file matches waiting players
  by rating and criteria, gives up after a timeout, and moves each match into
  a new room. Cocos, Unity and web players can wait in the same queue. See the
  [lobby-js README](https://github.com/hibira-io/lobby-js#matchmaking-queue).
- **`HibiraConnection`**: a component that holds the connection across
  scenes, with the app key and auth endpoint set in the Inspector.
- An auth endpoint as a Cloudflare Worker (free plan) in [`server/`](server).

## Set up

1. Create a free app at [hibira.io](https://hibira.io/portal) (no card). In
   its settings, turn on **Allow client events**.
2. Deploy the auth endpoint. It signs room subscriptions with your app
   secret, which must never ship inside the game:

   ```sh
   cd server
   # put your app key in wrangler.toml, then:
   npx wrangler deploy
   npx wrangler secret put HIBIRA_APP_SECRET
   ```

3. Copy [`assets/hibira`](assets/hibira) into your project's `assets/`
   (or unzip `hibira-cocos-<version>.zip` from the
   [latest release](https://github.com/hibira-io/cocos/releases/latest)).
4. Add the **HibiraConnection** component to a root node of your first
   scene (not one under Canvas: only root nodes can persist across scenes).
   Set **App Key** (the key, never the secret) and **Auth Endpoint** (your
   Worker's URL).
5. In the app's Settings in the portal, add every origin your game runs on
   to **Allowed origins**: `http://localhost:7456` for the editor's browser
   preview, and the site of each web build. Browsers from other origins are
   refused; the Free plan does not accept `*`.

For WeChat and other mini-game builds, add `ws.hibira.io` (socket) and your
auth endpoint's host (request) to the platform's allowed domains.

## Use

```ts
import { HibiraConnection } from './hibira/HibiraConnection';

const hibira = HibiraConnection.instance!;
hibira.setName('Ann');

const room = hibira.joinRoom('ABCD', { capacity: 4 });
// 'ready' brings the first member list, 'members' every change after it.
const render = ({ players, host }) => {
  // players: [{ id, info: { name }, ready, host, me }] in seat order
};
room.on('ready', render);
room.on('members', render);
room.on('message', (m) => console.log(`${m.info?.name}: ${m.text}`));
room.on('start', ({ data }) => startGame(data.seed));

// From buttons, once 'ready' has fired (before that, these throw):
onReadyButton = () => room.setReady(!room.ready);
onChatButton = (text) => room.send(text);
onStartButton = () => {
  if (room.isHost && room.allReady) room.start({ seed: 42 });
};

// Game events go on the same channel. Names start with client-, at most
// 10 per second per player; the receiver gets the sender's user_id.
const channel = hibira.client!.channel(room.name)!;
channel.bind('client-move', (pos, meta) => moveGhost(meta?.user_id, pos));
channel.trigger('client-move', { x: 10, y: 4 });
```

Events from your backend (scores, notices) arrive on any channel:

```ts
hibira.client!.subscribe('scores').bind('goal', (data) => showGoal(data));
```

Rooms are presence channels named `presence-room-<CODE>`, the same as the
[lobby example](https://hibira-io.github.io/examples/), so a Cocos game and
a web page in the same room see each other. `assets/hibira-example` has a
small lobby (`LobbyExample`) to start from; delete it when you are done.

### HibiraClient without the component

```ts
import { HibiraClient } from './hibira/HibiraClient';

const client = new HibiraClient('your-app-key', {
  authEndpoint: 'https://hibira-cocos-auth.example.workers.dev',
  authParams: () => ({ user_id: playerId, name: playerName }),
});
client.connection.bind('state_change', ({ current }) => console.log(current));
```

It reconnects by itself (1 s up to `maxReconnectDelay`, default 10 s) and
subscribes its channels again. It stops on `disconnect()` and on errors
4000-4099 (wrong key, app off).

## Auth endpoint

`server/worker.js` signs subscriptions to channels starting with
`presence-room-` (`ROOM_PREFIX`). It takes the `user_id` and `name` the game
sends and adds `joined_at`, which every player uses to agree on seat order
and host. With your own login, take the ID and name from the player's
session instead. `ROOM_CAPACITY` (with `HIBIRA_APP_ID`) refuses players past
that many per room. Node backends can use `authorizeRoom` from
`@hibira-io/lobby/server` instead.

## Develop

```sh
npm install
npm test         # typecheck, unit tests
HIBIRA_E2E_KEY=... HIBIRA_E2E_SECRET=... HIBIRA_E2E_HOST=ws.hibira.io npm run test:e2e
```

`assets/hibira/lobby.js`, `lobby-queue.js` and `lobby-match.js` are copies of
@hibira-io/lobby; update them with `npm run sync-lobby`.

## 中文

在 [Hibira](https://hibira.io/zh-cn/?utm_source=github&utm_medium=readme&utm_campaign=plugins)
上为 Cocos Creator 3.x 游戏加入实时多人功能。Hibira 是兼容 Pusher Channels
协议的托管实时服务。

- **HibiraClient**：无依赖的 Pusher 协议客户端，只需要 Cocos 在 Web、原生
  （iOS、Android、Windows、macOS）和小游戏平台都提供的 `WebSocket` 与
  `XMLHttpRequest`。
- **房间大厅**：座位、房主、准备状态、房间设置、踢人、开始游戏和房间聊天，
  不需要游戏服务器。与 [@hibira-io/lobby](https://github.com/hibira-io/lobby-js)
  相同，Cocos 玩家可与使用 pusher-js 的网页玩家同房间。
- **匹配队列**：同一文件中的 `Queue` 按评分与条件匹配排队玩家，超时会放弃，
  匹配成功后自动进入新房间。Cocos、Unity 与网页玩家可排同一个队列。
- **HibiraConnection** 组件：在 Inspector 填写 App Key 与 Auth Endpoint，
  切换场景时保持连接。

步骤：

1. 在 [hibira.io](https://hibira.io/portal) 免费建立应用（不需信用卡），并在
   「设置」中开启 **允许客户端事件**。Secret 只在建立时显示一次，请立即复制。
2. 部署 `server/` 中的 Cloudflare Worker（`npx wrangler deploy`，再用
   `npx wrangler secret put HIBIRA_APP_SECRET` 设定密钥）。密钥绝不能放进游戏里。
3. 将 `assets/hibira` 复制到项目的 `assets/`。
4. 在第一个场景的根节点（不要放在 Canvas 底下，只有根节点能跨场景保留）上加入 **HibiraConnection** 组件，填写 App Key（不是
   Secret）与 Worker 的网址，然后用 `HibiraConnection.instance.joinRoom('ABCD')`
   加入房间。
5. 在「设置」的 **允许的来源** 加入游戏运行的来源：编辑器浏览器预览为
   `http://localhost:7456`，以及每个网页版的网址。免费方案不能填 `*`。

微信等小游戏平台需将 `ws.hibira.io`（socket）与验证端点的域名（request）加入
合法域名。

## License

MIT
