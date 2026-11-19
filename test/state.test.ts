import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {makeProjectFixture} from './helpers/project.ts';
const state = await import('../src/state.ts');

test('hash-is-canonical', () => {
  assert.equal(typeof state.canonicalHash, 'function', 'canonicalHash is implemented');
  assert.equal(state.canonicalHash({b: 2, a: 1}), state.canonicalHash({a: 1, b: 2}));
  assert.notEqual(state.canonicalHash([1, 2]), state.canonicalHash([2, 1]));
});
test('registry-corruption-is-not-empty', async t => {
  const {root} = await makeProjectFixture(t);
  await mkdir(path.join(root, '.mad-openspec'));
  const file = path.join(root, '.mad-openspec/registry.json');
  for (const content of ['{broken', '{"schemaVersion":1,"stories":[]}', '{"schemaVersion":1,"stories":{"1.2":{}}}']) {
    await writeFile(file, content);
    assert.equal(typeof state.readRegistry, 'function');
    await assert.rejects(state.readRegistry(root), {code: 'INVALID_REGISTRY'});
    assert.equal(await readFile(file, 'utf8'), content);
  }
});
test('concurrent-mutation-is-blocked', async t => {
  const {root} = await makeProjectFixture(t);
  assert.equal(typeof state.withProjectLock, 'function');
  await state.withProjectLock(root, async () => {
    await assert.rejects(state.withProjectLock(root, () => assert.fail('must not execute')), {code: 'PROJECT_LOCKED'});
  });
  await assert.rejects(state.withProjectLock(root, async () => {throw new Error('injected');}), /injected/);
  await state.withProjectLock(root, async () => {});
  assert.equal((await readdir(path.join(root, '.mad-openspec'))).includes('write.lock'), false);
});
test('atomic-write-preserves-old-registry-on-serialization-failure', async t => {
  const {root} = await makeProjectFixture(t);
  const value = {schemaVersion: 1, stories: {}};
  assert.equal(typeof state.writeRegistry, 'function');
  await state.writeRegistry(root, value);
  const file = path.join(root, '.mad-openspec/registry.json');
  const before = await readFile(file, 'utf8');
  await assert.rejects(state.writeRegistry(root, {schemaVersion: 1, stories: {bad: 1n}}));
  assert.equal(await readFile(file, 'utf8'), before);
});
