import {CliError} from '../src/errors.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {makeProjectFixture} from './helpers/project.ts';
const mod = await import('../src/openspec.ts');

test('native-json-contract', async t => {
  const {root} = await makeProjectFixture(t, {prefix: 'проект ; $()-'});
  const seen: {file: string; args: string[]; options: import('../src/types.ts').ProcessOptions}[] = [];
  const sourcePath = path.join(root, 'openspec/changes/story-1-2/tasks.md');
  await mkdir(path.dirname(sourcePath));
  assert.equal(typeof mod.makeOpenSpec, 'function');
  const adapter = mod.makeOpenSpec({cwd: root, binPath: '/a folder/openspec.js', runProcess: async (file, args, options) => {
    seen.push({file, args, options});
    const value = args.includes('instructions') ? {state: 'all_done', tasks: [{id: '1', description: 'Сделать', done: true, sourcePath, line: 2}], progress: {total: 1, complete: 1, remaining: 0}, root: {path: root}} : {archive: {change: 'story-1-2', archivedAs: '2026-11-09-story-1-2', path: path.join(root, 'openspec/changes/archive/2026-11-09-story-1-2'), specsUpdated: true}, root: {path: root}};
    return {code: 0, stdout: JSON.stringify(value), stderr: 'diagnostic'};
  }});
  assert.deepEqual(await adapter.tasks('story-1-2'), {tasks: [{id: '1', description: 'Сделать', done: true, sourcePath, line: 2}], total: 1, completed: 1, remaining: 0});
  assert.equal((await adapter.archive('story-1-2')).specsUpdated, true);
  assert.equal(seen[0].file, process.execPath);
  assert.deepEqual(seen[0].args, ['/a folder/openspec.js', 'instructions', 'apply', '--change', 'story-1-2', '--json']);
  assert.equal(seen[0].options.cwd, root);
  assert.deepEqual(seen[1].args.slice(1), ['archive', 'story-1-2', '--yes', '--json']);
});
test('zero-exit-invalid-json', async t => {
  const {root} = await makeProjectFixture(t);
  assert.equal(typeof mod.makeOpenSpec, 'function');
  for (const stdout of ['not json', '{}', JSON.stringify({schemaName: 'spec-driven', artifacts: []})]) {
    const adapter = mod.makeOpenSpec({cwd: root, runProcess: async () => ({code: 0, stdout, stderr: ''})});
    await assert.rejects(adapter.status('story-1-2'), {code: 'INVALID_OPENSPEC_RESPONSE'});
  }
});
test('nonzero-native-exit-is-not-success', async t => {
  const {root} = await makeProjectFixture(t);
  assert.equal(typeof mod.makeOpenSpec, 'function');
  const adapter = mod.makeOpenSpec({cwd: root, runProcess: async () => ({code: 1, stdout: '{"archive":null}', stderr: 'merge conflict'})});
  await assert.rejects(adapter.archive('story-1-2'), e => e instanceof CliError && e.code === 'OPENSPEC_FAILED' && /merge conflict/.test(e.message));
});

test('native-noop-archive-needs-zero-totals', async t => {
  const {root} = await makeProjectFixture(t);
  for (const totals of [undefined, {added: 1, modified: 0, removed: 0, renamed: 0}, {added: 0, modified: 0, removed: 0, renamed: 0}]) {
    const adapter = mod.makeOpenSpec({cwd: root, runProcess: async () => ({code: 0, stdout: JSON.stringify({root: {path: root}, archive: {change: 'story-1-2', archivedAs: '2026-11-09-story-1-2', path: path.join(root, 'openspec/changes/archive/2026-11-09-story-1-2'), specsUpdated: false, totals}}), stderr: ''})});
    if (totals?.added === 0) assert.equal((await adapter.archive('story-1-2')).specsUpdated, false);
    else await assert.rejects(adapter.archive('story-1-2'), {code: 'INVALID_OPENSPEC_RESPONSE'});
  }
});

test('native-root-alias-uses-physical-paths', async t => {
  const {root} = await makeProjectFixture(t);
  const {symlink} = await import('node:fs/promises');
  const alias = path.join(root, 'root-alias');
  await symlink('.', alias);
  const adapter = mod.makeOpenSpec({cwd: alias, runProcess: async (_file, args, {cwd}) => {
    assert.equal(cwd, root);
    const result = args.includes('new')
      ? {change: {id: 'story-1-2', schema: 'spec-driven', path: path.join(root, 'openspec/changes/story-1-2'), metadataPath: path.join(root, 'openspec/changes/story-1-2/.openspec.yaml')}}
      : {archive: {change: 'story-1-2', archivedAs: '2026-11-09-story-1-2', path: path.join(root, 'openspec/changes/archive/2026-11-09-story-1-2'), specsUpdated: true}};
    return {code: 0, stdout: JSON.stringify({...result, root: {path: root, source: 'nearest'}}), stderr: ''};
  }});
  await adapter.create('story-1-2');
  assert.equal((await adapter.archive('story-1-2')).specsUpdated, true);
});
