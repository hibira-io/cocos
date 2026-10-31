// Puts the lobby files next to the compiled HibiraClient.js for the Node tests.
import { copyFileSync } from 'node:fs';

for (const file of ['lobby.js', 'lobby-queue.js', 'lobby-match.js']) {
  copyFileSync(`assets/hibira/${file}`, `test/.build/${file}`);
}
