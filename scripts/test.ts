import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../test/', import.meta.url));
const files = readdirSync(directory)
  .filter(name => name.endsWith('.test.ts') && name !== 'smoke.test.ts')
  .sort().map(name => path.join(directory, name));
const result = spawnSync(process.execPath, ['--test', ...files], {stdio: 'inherit'});
process.exitCode = result.status ?? 1;
