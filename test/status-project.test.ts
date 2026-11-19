import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, mkdir, rm, symlink, readFile} from 'node:fs/promises';
import path from 'node:path';
import {runCli} from '../src/cli.ts';
import {collectProjectStatus} from '../src/status-project.ts';
import {configuredFixture, makeProjectFixture, readyChangeFixture, snapshot} from './helpers/project.ts';
import type {BmadConfig, OpenSpec, StatusReport} from '../src/types.ts';

const config: BmadConfig = {core: {output_folder: 'planning'}, modules: {bmm: {planning_artifacts: '{project-root}/{output_folder}', implementation_artifacts: '{project-root}/planning'}}};
async function unconnected(t: Parameters<typeof makeProjectFixture>[0]) {
  const f = await makeProjectFixture(t);
  await writeFile(path.join(f.root, '_bmad/config.toml'), '# config resolved by fixture\n');
  return f;
}
async function invoke(root: string, args: string[], openspec?: OpenSpec, resolveConfig = async () => config) {
  let stdout = '', stderr = '';
  const code = await runCli(args, {cwd: root, openspec, resolveConfig, stdout: text => {stdout += text;}, stderr: text => {stderr += text;}});
  return {code, stdout, stderr};
}

test('summary and JSON have parity, stable ordering and no writes', async t => {
  const f = await readyChangeFixture(t), before = await snapshot(f.root);
  const json = await invoke(f.root, ['status', '--json'], f.adapter);
  const both = await invoke(f.root, ['status', '--summary', '--json'], f.adapter);
  assert.equal(json.code, 0); assert.equal(json.stderr, ''); assert.equal(both.stdout, json.stdout);
  const report: StatusReport = JSON.parse(json.stdout);
  const summary = await invoke(f.root, ['status', '--summary'], f.adapter);
  assert.equal(summary.code, 0); assert.match(summary.stdout, /Эпик 1 — Команда/);
  assert.match(summary.stdout, /Эпик 2 — Отчёты/); assert.match(summary.stdout, /задачи выполнены, ожидает закрытия/);
  for (const row of report.stories) {assert.ok(summary.stdout.includes(row.storyId)); assert.ok(summary.stdout.includes(row.title!));}
  assert.deepEqual(await snapshot(f.root), before);
  assert.equal((await invoke(f.root, ['status', '--summary', '--summary'])).code, 2);
  assert.equal((await invoke(f.root, ['status', '--summary', '--bogus'])).code, 2);
  assert.match((await invoke(f.root, ['status', '--help'])).stdout, /--summary/);
});

test('missing Dependencies allow story selection but keep the implementation check unknown', async t => {
  const f = await configuredFixture(t);
  const backlog = ['## Epic 1: Team', '### Story 1.1: Create', '### Story 1.2: Invite'];
  await writeFile(path.join(f.root, f.paths.epics), backlog.join('\n'));

  const json = await invoke(f.root, ['status', '--json'], f.adapter);
  assert.equal(json.code, 0);
  const report: StatusReport = JSON.parse(json.stdout);
  assert.equal(report.summary.stage, 'ready');
  assert.match(report.summary.nextSteps.join(' '), /Выберите.*mad-openspec-prepare/);
  assert.deepEqual(report.stories.map(row => row.storyId), ['1.1', '1.2']);
  for (const row of report.stories) {
    assert.equal(row.dependencyState, 'unknown');
    assert.equal(row.dependsOn, null);
    const [issue] = row.issues;
    assert.equal(issue.code, 'DEPENDENCIES_FIELD_MISSING');
    assert.equal(issue.path, f.paths.epics);
    assert.ok(backlog[Number(issue.line) - 1].startsWith(`### Story ${row.storyId}:`));
  }
  const summary = await invoke(f.root, ['status', '--summary'], f.adapter);
  assert.equal(summary.code, 0);
  assert.match(summary.stdout, /Историй без поля Dependencies: 2\b/);
  const check = await invoke(f.root, ['change', 'check', '--story', '1.1', '--json'], f.adapter);
  assert.equal(check.code, 1);
  assert.equal(JSON.parse(check.stdout).dependencyState, 'unknown');
});

test('a dependency cycle still requires attention alongside a missing field', async t => {
  const f = await configuredFixture(t);
  await writeFile(path.join(f.root, f.paths.epics), [
    '## Epic 1: Team', '### Story 1.1: Create', '### Story 1.2: Invite', '**Dependencies:** Story 1.1',
    '## Epic 2: Reports', '### Story 2.1: Build', '**Dependencies:** Story 2.2',
    '### Story 2.2: Publish', '**Dependencies:** Story 2.1'
  ].join('\n'));
  const sprint = path.join(f.root, f.paths.sprintStatus);
  await writeFile(sprint, await readFile(sprint, 'utf8') + '  2-1-build: backlog\n  2-2-publish: backlog\n');

  const json = await invoke(f.root, ['status', '--json'], f.adapter);
  assert.equal(json.code, 1);
  const report: StatusReport = JSON.parse(json.stdout);
  assert.equal(report.summary.stage, 'attention');
  const summary = await invoke(f.root, ['status', '--summary'], f.adapter);
  assert.equal(summary.code, 1);
  assert.match(summary.stdout, /DEPENDENCY_CYCLE.*2\.1 -> 2\.2 -> 2\.1/);
  assert.match(summary.stdout, /Историй без поля Dependencies: 1\b/);
});

test('unconnected status discovers configured documents without calling OpenSpec or connecting', async t => {
  const f = await unconnected(t), before = await snapshot(f.root);
  const result = await invoke(f.root, ['status', '--summary', '--json']);
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  const report: StatusReport = JSON.parse(result.stdout);
  assert.equal(report.inputs.connection.state, 'missing');
  assert.deepEqual(report.inputs.backlog, {state: 'present', path: f.paths.epics});
  assert.deepEqual(report.inputs.sprintStatus, {state: 'present', path: f.paths.sprintStatus});
  assert.equal(report.summary.stage, 'not-connected'); assert.equal(report.summary.counts['not-started'], 2);
  assert.ok(report.stories.every(s => s.dependencyState === 'unknown'));
  assert.match(report.summary.nextSteps.join(' '), /connect/);
  assert.match((await invoke(f.root, ['status'])).stdout, /backlog не подключён/);
  assert.deepEqual(await snapshot(f.root), before);
});

test('early status distinguishes unknown location, missing documents and empty epics', async t => {
  const f = await makeProjectFixture(t);
  let calls = 0;
  let report = await collectProjectStatus(f.root, {resolveConfig: async () => {calls++; return config;}});
  assert.equal(calls, 0); assert.equal(report.inputs.backlog.state, 'unknown'); assert.equal(report.issues.length, 0);
  await writeFile(path.join(f.root, '_bmad/config.toml'), '# config\n');
  await rm(path.join(f.root, f.paths.sprintStatus));
  let result = await invoke(f.root, ['status', '--json']);
  report = JSON.parse(result.stdout);
  assert.equal(result.code, 0); assert.equal(report.stories.length, 2);
  assert.equal(report.inputs.sprintStatus.state, 'missing'); assert.equal(report.summary.counts.unknown, 2);
  assert.equal(report.summary.stage, 'planning'); assert.match(report.summary.nextSteps.join(' '), /sprint-planning/);
  await writeFile(path.join(f.root, f.paths.epics), '## Epic 1: Empty\n');
  report = JSON.parse((await invoke(f.root, ['status', '--json'])).stdout);
  assert.equal(report.epics.length, 1); assert.equal(report.stories.length, 0); assert.notEqual(report.summary.stage, 'complete');
  await rm(path.join(f.root, f.paths.epics));
  result = await invoke(f.root, ['status', '--summary', '--json']); report = JSON.parse(result.stdout);
  assert.equal(result.code, 0); assert.equal(report.inputs.backlog.state, 'missing');
  assert.match(report.summary.nextSteps.join(' '), /create-epics-and-stories/);
});

test('ambiguous and malformed discovery preserves independent sources and never picks a candidate', async t => {
  const f = await unconnected(t);
  await writeFile(path.join(f.root, 'planning/epics-other.md'), '## Epic 9: Other');
  let result = await invoke(f.root, ['status', '--json']); let report: StatusReport = JSON.parse(result.stdout);
  assert.equal(result.code, 1); assert.equal(report.inputs.backlog.state, 'ambiguous'); assert.equal(report.inputs.backlog.path, null);
  assert.deepEqual(report.inputs.backlog.candidates, ['planning/epics-other.md', 'planning/epics.md']);
  assert.equal(report.inputs.sprintStatus.state, 'present'); assert.equal(report.stories.length, 0);
  await rm(path.join(f.root, 'planning/epics-other.md'));
  await writeFile(path.join(f.root, f.paths.sprintStatus), '{bad');
  result = await invoke(f.root, ['status', '--json']); report = JSON.parse(result.stdout);
  assert.equal(result.code, 1); assert.equal(report.inputs.sprintStatus.state, 'invalid'); assert.equal(report.stories.length, 2);
  assert.ok(report.stories.every(s => s.workflowState === 'unknown'));
  const failed = await invoke(f.root, ['status', '--json'], undefined, async () => {throw new Error('resolver unavailable');});
  assert.equal(failed.code, 1); assert.equal(JSON.parse(failed.stdout).inputs.backlog.state, 'unknown');
});

test('connected paths win; corrupt config never falls back to discovery', async t => {
  const f = await configuredFixture(t);
  const resolveConfig = async (): Promise<BmadConfig> => {throw new Error('must not discover saved paths');};
  assert.equal((await invoke(f.root, ['status', '--summary'], f.adapter, resolveConfig)).code, 0);
  await rm(path.join(f.root, f.paths.sprintStatus));
  let result = await invoke(f.root, ['status', '--json'], f.adapter, resolveConfig);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).inputs.sprintStatus.state, 'missing');
  assert.equal(JSON.parse(result.stdout).stories.length, 2);
  await writeFile(path.join(f.root, '.mad-openspec/config.json'), '{bad');
  result = await invoke(f.root, ['status', '--summary', '--json'], f.adapter, resolveConfig);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).inputs.connection.state, 'invalid');
  assert.equal(JSON.parse(result.stdout).issues[0].code, 'INVALID_CONFIG');
});

test('preconnect discovery refuses external symlinks and config-less registry completion', async t => {
  const f = await unconnected(t), outside = await makeProjectFixture(t);
  await rm(path.join(f.root, f.paths.epics));
  await symlink(path.join(outside.root, outside.paths.epics), path.join(f.root, f.paths.epics));
  let result = await invoke(f.root, ['status', '--json']);
  assert.equal(result.code, 1); assert.ok(JSON.parse(result.stdout).issues.some((i: {code: string}) => i.code === 'UNSAFE_PATH'));
  await rm(path.join(f.root, f.paths.epics));
  await writeFile(path.join(f.root, f.paths.epics), await readFile(path.join(outside.root, outside.paths.epics)));
  await mkdir(path.join(f.root, '.mad-openspec'));
  await writeFile(path.join(f.root, '.mad-openspec/registry.json'), '{"schemaVersion":1,"stories":{}}');
  await writeFile(path.join(f.root, f.paths.sprintStatus), (await readFile(path.join(f.root, f.paths.sprintStatus), 'utf8')).replace('backlog # other story', 'done # other story'));
  result = await invoke(f.root, ['status', '--json']);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).summary.counts.done, 0);
  assert.ok(JSON.parse(result.stdout).stories.every((s: {workflowState: string}) => s.workflowState === 'unknown'));
});
