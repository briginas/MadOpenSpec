import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {readyChangeFixture, snapshot} from './helpers/project.ts';
import {readRegistry, writeRegistry} from '../src/state.ts';
const mod = await import('../src/close.ts');

test('reject-incomplete-or-empty-tasks', async t => {
  const {project, root, changeDir, adapter} = await readyChangeFixture(t);
  assert.equal(typeof mod.closeChange, 'function');
  for (const content of ['# Tasks\n', '# Tasks\n- [x] сделано\n- [ ] ещё работа\n']) {
    await writeFile(path.join(changeDir, 'tasks.md'), content);
    await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'INCOMPLETE_TASKS'});
  }
  assert.equal(adapter.calls.some(([name]) => name === 'archive'), false);
  assert.match(await readFile(path.join(root, 'planning/sprint-status.yaml'), 'utf8'), /ready-for-dev/);
});
test('reject-missing-artifacts', async t => {
  const {project, changeDir, adapter} = await readyChangeFixture(t);
  await rm(path.join(changeDir, 'design.md'));
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'MISSING_ARTIFACTS'});
  assert.equal(adapter.calls.some(([name]) => name === 'archive'), false);
});
test('strict-validation-blocks-close', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  adapter.validate = async () => {throw Object.assign(new Error('strict warning'), {code: 'OPENSPEC_FAILED'});};
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'OPENSPEC_FAILED'});
  assert.equal(adapter.calls.some(([name]) => name === 'archive'), false);
  assert.equal((await readRegistry(root)).stories['1.2'].phase, 'active');
});
test('archive-before-bmad', async t => {
  const {root, project, adapter} = await readyChangeFixture(t);
  const archive = adapter.archive;
  adapter.archive = async id => {
    assert.match(await readFile(path.join(root, 'planning/sprint-status.yaml'), 'utf8'), /ready-for-dev # selected/);
    assert.equal((await readRegistry(root)).stories['1.2'].phase, 'archiving');
    return archive(id);
  };
  assert.equal(typeof mod.closeChange, 'function');
  const result = await mod.closeChange(project, 'story-1-2', adapter);
  assert.equal(result.phase, 'closed');
  assert.ok(result.archivePath);
  assert.match(result.archivePath, /archive\/2026-11-09-story-1-2/);
  assert.match(await readFile(path.join(root, 'planning/sprint-status.yaml'), 'utf8'), /done # selected/);
  await access(path.join(root, result.archivePath, '.mad-openspec-link.json'));
  const before = await snapshot(root);
  await mod.closeChange(project, 'story-1-2', adapter);
  assert.deepEqual(await snapshot(root), before);
  assert.equal(adapter.calls.filter(([name]) => name === 'archive').length, 1);
});
test('does-not-run-project-checks', async t => {
  const {project, adapter, root} = await readyChangeFixture(t);
  // Any attempted shell/project check would fail the operation.
  await writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"exit 99","build":"exit 99","lint":"exit 99"}}');
  assert.equal(typeof mod.closeChange, 'function');
  await mod.closeChange(project, 'story-1-2', adapter);
  assert.equal(adapter.calls.some(([name]) => /test|lint|typecheck|build|exec/.test(name)), false);
});
test('resume-after-bmad-write-failure', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  const sprintPath = path.join(root, 'planning/sprint-status.yaml');
  const before = await readFile(sprintPath, 'utf8');
  const archive = adapter.archive;
  adapter.archive = async id => {
    const receipt = await archive(id);
    await writeFile(sprintPath, '{bad YAML');
    return receipt;
  };
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'INVALID_SPRINT_STATUS'});
  assert.equal((await readRegistry(root)).stories['1.2'].phase, 'archived');
  await writeFile(sprintPath, before);
  const result = await mod.closeChange(project, 'story-1-2', adapter);
  assert.equal(result.phase, 'closed');
  assert.ok(result.archivePath);
  assert.equal(adapter.calls.filter(([name]) => name === 'archive').length, 1);
});
test('uncertain-archive-needs-recovery', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  const archive = adapter.archive;
  adapter.archive = async id => {await archive(id); throw new Error('Lost receipt');};
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'RECOVERY_REQUIRED'});
  assert.equal((await readRegistry(root)).stories['1.2'].phase, 'recovery-required');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'RECOVERY_REQUIRED'});
  assert.match(await readFile(path.join(root, 'planning/sprint-status.yaml'), 'utf8'), /ready-for-dev/);
  assert.equal(adapter.calls.filter(([name]) => name === 'archive').length, 1);
});
test('unchanged-archive-failure-can-be-retried', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  const archive = adapter.archive;
  adapter.archive = async () => {throw Object.assign(new Error('Native conflict before write'), {code: 'OPENSPEC_FAILED'});};
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'OPENSPEC_FAILED'});
  assert.equal((await readRegistry(root)).stories['1.2'].phase, 'active');
  adapter.archive = archive;
  assert.equal((await mod.closeChange(project, 'story-1-2', adapter)).phase, 'closed');
});
test('resume-after-sprint-update-before-story-file', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  const registry = await readRegistry(root); registry.stories['1.2'].storyFile = 'planning/story.md';
  await writeRegistry(root, registry);
  const storyPath = path.join(root, 'planning/story.md');
  await writeFile(storyPath, 'Status: review\n');
  const archive = adapter.archive;
  adapter.archive = async id => {
    const receipt = await archive(id);
    await writeFile(storyPath, 'Status: review\nStatus: duplicate\n');
    return receipt;
  };
  assert.equal(typeof mod.closeChange, 'function');
  await assert.rejects(mod.closeChange(project, 'story-1-2', adapter), {code: 'INVALID_STORY_FILE'});
  // Simulate one of two idempotent writes having committed before interruption.
  const sprintPath = path.join(root, 'planning/sprint-status.yaml');
  await writeFile(sprintPath, (await readFile(sprintPath, 'utf8')).replace('ready-for-dev # selected', 'done # selected'));
  await writeFile(storyPath, 'Status: review\n');
  const result = await mod.closeChange(project, 'story-1-2', adapter);
  assert.equal(result.phase, 'closed');
  assert.ok(result.archivePath);
  assert.equal(await readFile(storyPath, 'utf8'), 'Status: done\n');
  assert.equal(adapter.calls.filter(([name]) => name === 'archive').length, 1);
});
