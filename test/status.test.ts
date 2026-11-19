import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readyChangeFixture, configuredFixture, snapshot} from './helpers/project.ts';
import {closeChange} from '../src/close.ts';
const mod = await import('../src/status.ts');

test('status-does-not-write', async t => {
  const {root, project, adapter} = await readyChangeFixture(t);
  const before = await snapshot(root);
  assert.equal(typeof mod.collectStatus, 'function');
  const report = await mod.collectStatus(project, adapter);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.stories[0].storyId, '1.1');
  assert.equal(report.stories[0].changeId, null);
  assert.equal(report.stories[1].changeId, 'story-1-2');
  assert.deepEqual(report.stories[1].tasks, {total: 6, completed: 6, remaining: 0});
  assert.deepEqual(await snapshot(root), before);
});
test('corruption-is-not-zero-tasks', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  adapter.tasks = async () => {throw Object.assign(new Error('cannot read tasks'), {code: 'OPENSPEC_FAILED'});};
  assert.equal(typeof mod.collectStatus, 'function');
  const report = await mod.collectStatus(project, adapter);
  assert.equal(report.stories[1].tasks, null);
  assert.equal(report.stories[1].issues[0].code, 'OPENSPEC_FAILED');
  await writeFile(path.join(root, '.mad-openspec/registry.json'), '{invalid');
  const before = await snapshot(root);
  const corrupt = await mod.collectStatus(project, adapter);
  assert.ok(corrupt.issues.some(x => x.code === 'INVALID_REGISTRY'));
  assert.equal(corrupt.stories[1].tasks, null);
  assert.deepEqual(await snapshot(root), before);
});
test('archived-bmad-pending-is-visible', async t => {
  const {project, root, adapter} = await readyChangeFixture(t);
  const archive = adapter.archive;
  adapter.archive = async id => {const result = await archive(id); await writeFile(path.join(root, 'planning/sprint-status.yaml'), '{bad'); return result;};
  await assert.rejects(closeChange(project, 'story-1-2', adapter));
  assert.equal(typeof mod.collectStatus, 'function');
  const report = await mod.collectStatus(project, adapter);
  assert.equal(report.stories[1].phase, 'archived');
  assert.ok(report.stories[1].issues.some(x => x.code === 'BMAD_UPDATE_PENDING'));
  assert.ok(report.stories[1].archivePath);
  assert.match(report.stories[1].archivePath, /archive/);
});
test('status-with-no-registry-is-read-only-backlog', async t => {
  const {root, project, adapter} = await configuredFixture(t);
  const before = await snapshot(root);
  assert.equal(typeof mod.collectStatus, 'function');
  const report = await mod.collectStatus(project, adapter);
  assert.equal(report.stories.length, 2);
  assert.equal(report.stories[0].tasks, null);
  assert.deepEqual(await snapshot(root), before);
});

test('status dependency fields match addressed checks and preserve lifecycle fields without writes', async t => {
  const {checkDependencies} = await import('../src/dependencies.ts');
  const {readFile} = await import('node:fs/promises');
  const f = await readyChangeFixture(t), epics = path.join(f.root, f.paths.epics);
  const original = await readFile(epics, 'utf8');
  await writeFile(epics, original.replace('**Dependencies:** none', '**Dependencies:** Story 1.2'));
  for (const unknown of [false, true]) {
    if (unknown) await writeFile(epics, original.replace('**Dependencies:** none', '**Dependencies:** unrecognized'));
    const before = await snapshot(f.root), report = await mod.collectStatus(f.project, f.adapter);
    for (const row of report.stories) {
      const check = await checkDependencies(f.project, row.storyId);
      assert.equal(row.dependencyState, check.dependencyState); assert.deepEqual(row.dependsOn, check.dependsOn); assert.deepEqual(row.blockedBy, check.blockedBy);
    }
    assert.equal(report.stories[1].phase, 'active'); assert.equal(report.stories[1].changeId, 'story-1-2');
    assert.deepEqual(report.stories[1].tasks, {total: 6, completed: 6, remaining: 0});
    assert.equal(report.stories[0].dependencyState, unknown ? 'unknown' : 'blocked');
    assert.deepEqual(await snapshot(f.root), before);
  }
});

test('summary distinguishes prepared, progress, completed tasks and verified closure', async t => {
  const {readFile} = await import('node:fs/promises');
  const {formatStatus} = await import('../src/status-text.ts');
  const f = await readyChangeFixture(t), tasks = path.join(f.changeDir, 'tasks.md');
  const done = await readFile(tasks, 'utf8');
  const cases = [[done.replaceAll('[x]', '[ ]'), 'prepared', 0], [done.replaceAll('[x]', '[ ]').replace('[ ]', '[x]'), 'in-progress', 1], [done, 'tasks-complete', 6]] as const;
  for (const [content, state, completed] of cases) {
    await writeFile(tasks, content);
    const before = await snapshot(f.root), report = await mod.collectStatus(f.project, f.adapter);
    assert.equal(report.stories[1].workflowState, state);
    assert.equal(report.stories[1].tasks?.completed, completed);
    assert.equal(report.summary.counts[state], 1); assert.equal(report.summary.counts.done, 0);
    assert.deepEqual(report.summary.activeStoryIds, ['1.2']);
    assert.equal(report.stories[0].workflowState, 'not-started');
    assert.deepEqual(report.epics.map(e => [e.epicId, e.title, e.storyIds]), [['1', 'Команда', ['1.1', '1.2']], ['2', 'Отчёты', []]]);
    assert.match(formatStatus(report, {overview: true}), /Историй пока нет/);
    assert.deepEqual(await snapshot(f.root), before);
  }
  await closeChange(f.project, 'story-1-2', f.adapter);
  const closed = await mod.collectStatus(f.project, f.adapter);
  assert.equal(closed.stories[1].workflowState, 'done'); assert.equal(closed.summary.counts.done, 1);
  assert.deepEqual(closed.summary.activeStoryIds, []);
});

test('summary keeps lifecycle separate from dependencies and shows all open stories', async t => {
  const {readFile} = await import('node:fs/promises');
  const {formatStatus} = await import('../src/status-text.ts');
  const f = await readyChangeFixture(t), sprint = path.join(f.root, f.paths.sprintStatus), backlog = path.join(f.root, f.paths.epics);
  await writeFile(sprint, (await readFile(sprint, 'utf8')).replace('backlog # other story', 'in-progress # other story'));
  await writeFile(backlog, (await readFile(backlog, 'utf8')).replace('**Dependencies:** none', '**Dependencies:** Story 1.2'));
  const report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.stories[0].workflowState, 'in-progress'); assert.equal(report.stories[0].dependencyState, 'blocked');
  assert.equal(report.stories[1].workflowState, 'tasks-complete');
  assert.deepEqual(report.summary.activeStoryIds, ['1.1', '1.2']); assert.match(formatStatus(report, {overview: true}), /ожидает 1.2/);
  await writeFile(backlog, (await readFile(backlog, 'utf8')).replace('Story 1.2\n', 'unrecognized\n'));
  const unknown = await mod.collectStatus(f.project, f.adapter);
  assert.equal(unknown.stories[0].workflowState, 'in-progress'); assert.equal(unknown.stories[0].dependencyState, 'unknown');
});

test('summary never counts corrupt or contradictory completion as done', async t => {
  const {readFile} = await import('node:fs/promises');
  const f = await readyChangeFixture(t), sprint = path.join(f.root, f.paths.sprintStatus);
  const original = await readFile(sprint, 'utf8');
  await writeFile(sprint, original.replace('ready-for-dev', 'done'));
  let report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.stories[1].workflowState, 'attention'); assert.equal(report.summary.counts.done, 0);
  assert.ok(report.stories[1].issues.some(i => i.code === 'INCONSISTENT_COMPLETION'));
  await writeFile(sprint, original.replace('ready-for-dev', 'invented'));
  report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.stories[1].workflowState, 'unknown'); assert.ok(report.stories[1].issues.some(i => i.code === 'UNKNOWN_BMAD_STATUS'));
  await writeFile(sprint, original);
  await writeFile(path.join(f.root, '.mad-openspec/registry.json'), '{bad');
  report = await mod.collectStatus(f.project, f.adapter);
  assert.ok(report.stories.every(s => ['unknown', 'attention'].includes(s.workflowState))); assert.equal(report.summary.counts.done, 0);
});

test('status accepts an epic-only backlog without declaring completion', async t => {
  const f = await configuredFixture(t);
  await writeFile(path.join(f.root, f.paths.epics), '## Epic 10: Later\n## Epic 2: First\n');
  const report = await mod.collectStatus(f.project, f.adapter);
  assert.deepEqual(report.epics.map(e => e.epicId), ['2', '10']); assert.equal(report.stories.length, 0);
  assert.equal(report.issues.length, 0); assert.equal(report.summary.stage, 'planning');
});

test('summary invalidates changed sources and distinguishes unavailable tasks from completion', async t => {
  const {readFile, rm} = await import('node:fs/promises');
  const f = await readyChangeFixture(t);
  const tasks = f.adapter.tasks;
  f.adapter.tasks = async id => {
    const result = await tasks(id);
    const file = path.join(f.root, f.paths.epics);
    await writeFile(file, (await readFile(file, 'utf8')) + '\n');
    return result;
  };
  let report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.inputs.backlog.state, 'unknown');
  assert.ok(report.stories.every(s => s.workflowState === 'unknown'));
  assert.ok(report.issues.some(i => i.code === 'SOURCE_CHANGED')); assert.equal(report.summary.counts.done, 0);
  f.adapter.tasks = tasks;
  await rm(path.join(f.changeDir, 'tasks.md'));
  report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.stories[1].workflowState, 'unknown'); assert.equal(report.stories[1].tasks, null);
});

test('unfinished close stays attention and all stories done does not finish an empty epic', async t => {
  const {readFile} = await import('node:fs/promises');
  const f = await readyChangeFixture(t);
  const archive = f.adapter.archive;
  f.adapter.archive = async id => {const result = await archive(id); await writeFile(path.join(f.root, f.paths.sprintStatus), '{bad'); return result;};
  const originalSprint = await readFile(path.join(f.root, f.paths.sprintStatus), 'utf8');
  await assert.rejects(closeChange(f.project, 'story-1-2', f.adapter));
  let report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.stories[1].workflowState, 'attention'); assert.equal(report.summary.counts.done, 0);
  await writeFile(path.join(f.root, f.paths.sprintStatus), originalSprint.replace('backlog # other story', 'done # other story'));
  await closeChange(f.project, 'story-1-2', f.adapter);
  report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.summary.counts.done, 2); assert.notEqual(report.summary.stage, 'complete');
  const epicsFile = path.join(f.root, f.paths.epics);
  await writeFile(epicsFile, (await readFile(epicsFile, 'utf8')).replace('## Epic 2: Отчёты\n', ''));
  report = await mod.collectStatus(f.project, f.adapter);
  assert.equal(report.summary.stage, 'complete');
});
