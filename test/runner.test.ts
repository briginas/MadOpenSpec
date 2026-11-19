import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('runner-loads-tests-in-checkout-with-spaces-and-unicode', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'Mad проект -'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'test'));
  const runner = path.join(root, 'scripts/test.ts');
  await copyFile(new URL('../scripts/test.ts', import.meta.url), runner);
  await writeFile(path.join(root, 'test/basic.test.ts'), "import {test} from 'node:test';\nimport {writeFileSync} from 'node:fs';\ntest('selected-fixture-test', () => {writeFileSync('selected-test-ran', 'ok');});\n");
  await writeFile(path.join(root, 'test/smoke.test.ts'), "throw new Error('Smoke must be excluded from unit tests');\n");
  // Run as a standalone command, outside the parent node:test worker context.
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [runner], {cwd: root, env, encoding: 'utf8', timeout: 30000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(await readFile(path.join(root, 'selected-test-ran'), 'utf8'), 'ok');
});
