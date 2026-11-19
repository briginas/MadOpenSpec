import {test} from 'node:test';
import assert from 'node:assert/strict';
import {symlink, access, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {makeProjectFixture} from './helpers/project.ts';
import {fakeOpenSpec} from './helpers/openspec.ts';
const project = await import('../src/project.ts');

test('symlink-escape-is-rejected', async t => {
  const {root} = await makeProjectFixture(t);
  const {root: outside} = await makeProjectFixture(t);
  await symlink(outside, path.join(root, 'escape'));
  assert.equal(typeof project.assertWritablePath, 'function');
  await assert.rejects(project.assertWritablePath(root, 'escape/new/deep.txt'), {code: 'UNSAFE_PATH'});
  await assert.rejects(project.assertWritablePath(root, '../outside'), {code: 'UNSAFE_PATH'});
  await assert.rejects(access(path.join(outside, 'new')));
});
test('unicode-project-path', async t => {
  const {root} = await makeProjectFixture(t, {prefix: 'Мой проект ; $ -'});
  assert.equal(typeof project.assertWritablePath, 'function');
  assert.equal(await project.assertWritablePath(root, 'новые файлы/данные.json'), path.join(root, 'новые файлы/данные.json'));
});
test('load-config-rejects-corruption-and-unsupported-shape', async t => {
  const {root} = await makeProjectFixture(t);
  await mkdir(path.join(root, '.mad-openspec'));
  await writeFile(path.join(root, '.mad-openspec/config.json'), '{}');
  assert.equal(typeof project.loadConfig, 'function');
  await assert.rejects(project.loadConfig(root), {code: 'INVALID_CONFIG'});
});

test('rejects-version-or-store-mismatch', async t => {
  const {root, paths} = await makeProjectFixture(t);
  assert.equal(typeof project.initProject, 'function');
  await assert.rejects(project.initProject(root, paths, fakeOpenSpec(root, {version: async () => '2.0.0'})), {code: 'UNSUPPORTED_VERSION'});
  await assert.rejects(project.initProject(root, paths, fakeOpenSpec(root, {context: async () => ({root: {path: '/other/store', source: 'store'}})})), {code: 'UNSUPPORTED_OPENSPEC_ROOT'});
  await assert.rejects(access(path.join(root, '.mad-openspec/config.json')));
});
test('init-is-idempotent-and-never-installs-vendors', async t => {
  const {root, paths} = await makeProjectFixture(t);
  const adapter = fakeOpenSpec(root);
  assert.equal(typeof project.initProject, 'function');
  const first = await project.initProject(root, paths, adapter);
  assert.equal(first.config.bmad.version, '6.12.4');
  const loaded = await project.loadProject(root, adapter);
  assert.deepEqual(loaded, first);
  assert.deepEqual(await project.initProject(root, paths, adapter), first);
  assert.equal(adapter.calls.some(([name]) => ['install', 'init', 'create'].includes(name)), false);
  await writeFile(path.join(root, paths.manifest), 'installation:\n  version: 7.0.0\n');
  await assert.rejects(project.loadProject(root, adapter), {code: 'UNSUPPORTED_VERSION'});
});
