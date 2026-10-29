// Puts lobby.js next to the compiled HibiraClient.js for the Node tests.
import { copyFileSync } from 'node:fs';

copyFileSync('assets/hibira/lobby.js', 'test/.build/lobby.js');
