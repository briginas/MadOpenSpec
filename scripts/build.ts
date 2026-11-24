import {cp, mkdir, rm, chmod} from 'node:fs/promises';
import {openSkills} from '../src/openspec-skills.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
await rm(dist, {recursive: true, force: true});
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(dist, {recursive: true});
for (const asset of ['package.json', 'schemas', 'skills', 'assets']) {
  await cp(new URL(`../${asset}`, import.meta.url), new URL(asset, dist), {
    recursive: true,
    filter: source => !source.endsWith('/.DS_Store')
  });
}
for (const name of openSkills) {
  const file = `.agents/skills/${name}/SKILL.md`;
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, dist));
}
await chmod(new URL('bin/mad-openspec.js', dist), 0o755);
