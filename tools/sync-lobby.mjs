// Copies @hibira-io/lobby from node_modules into assets/hibira: index.js as
// lobby.js, queue.js and match.js as lobby-queue.js and lobby-match.js (with
// their imports renamed), and index.d.ts as lobby.d.ts. With --check it only
// fails when the copies are out of date.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const dir = 'node_modules/@hibira-io/lobby';
const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
const header =
  `// Copied from @hibira-io/lobby ${pkg.version} (https://github.com/hibira-io/lobby-js, MIT).\n` +
  '// It runs on HibiraClient as well as on pusher-js. Do not edit here; update it\n' +
  '// with: npm run sync-lobby\n\n';
const renames = [
  ["'./index.js'", "'./lobby.js'"],
  ["'./queue.js'", "'./lobby-queue.js'"],
  ["'./match.js'", "'./lobby-match.js'"],
];
const copy = (file) => {
  let text = readFileSync(`${dir}/${file}`, 'utf8');
  for (const [from, to] of renames) text = text.replaceAll(from, to);
  return header + text;
};

const dts = readFileSync(`${dir}/index.d.ts`, 'utf8')
  .replace(
    "import type Pusher from 'pusher-js';",
    `// Copied from @hibira-io/lobby ${pkg.version}, with the pusher-js type relaxed to any\n` +
      '// client that has subscribe() and unsubscribe(), such as HibiraClient.\n\n' +
      'export interface RoomClient {\n  subscribe(channelName: string): any;\n  unsubscribe(channelName: string): void;\n}',
  )
  .replaceAll('pusher: Pusher,', 'pusher: RoomClient,');

const files = {
  'assets/hibira/lobby.js': copy('index.js'),
  'assets/hibira/lobby-queue.js': copy('queue.js'),
  'assets/hibira/lobby-match.js': copy('match.js'),
  'assets/hibira/lobby.d.ts': dts,
};
let stale = false;
for (const [path, text] of Object.entries(files)) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
  if (process.argv.includes('--check')) {
    console.error(`${path} is out of date: npm run sync-lobby`);
    stale = true;
  } else {
    writeFileSync(path, text);
    console.log(`updated ${path}`);
  }
}
process.exit(stale ? 1 : 0);
