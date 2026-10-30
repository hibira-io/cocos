// Copies @hibira-io/lobby from node_modules into assets/hibira/lobby.js and
// lobby.d.ts. With --check it only fails when the copies are out of date.
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('node_modules/@hibira-io/lobby/package.json', 'utf8'));
const js =
  `// Copied from @hibira-io/lobby ${pkg.version} (https://github.com/hibira-io/lobby-js, MIT).\n` +
  '// It runs on HibiraClient as well as on pusher-js. Do not edit here; update it\n' +
  '// with: npm run sync-lobby\n\n' +
  readFileSync('node_modules/@hibira-io/lobby/index.js', 'utf8');
const dts = readFileSync('node_modules/@hibira-io/lobby/index.d.ts', 'utf8')
  .replace(
    "import type Pusher from 'pusher-js';",
    `// Copied from @hibira-io/lobby ${pkg.version}, with the pusher-js type relaxed to any\n` +
      '// client that has subscribe() and unsubscribe(), such as HibiraClient.\n\n' +
      'export interface RoomClient {\n  subscribe(channelName: string): any;\n  unsubscribe(channelName: string): void;\n}',
  )
  .replace('pusher: Pusher,', 'pusher: RoomClient,');

const files = { 'assets/hibira/lobby.js': js, 'assets/hibira/lobby.d.ts': dts };
let stale = false;
for (const [path, text] of Object.entries(files)) {
  if (readFileSync(path, 'utf8') === text) continue;
  if (process.argv.includes('--check')) {
    console.error(`${path} is out of date: npm run sync-lobby`);
    stale = true;
  } else {
    writeFileSync(path, text);
    console.log(`updated ${path}`);
  }
}
process.exit(stale ? 1 : 0);
