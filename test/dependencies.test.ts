import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseBacklog} from '../src/bmad.ts';
import {parseDependencyField, extractDependencyGraph, extractDependencies, checkDependencies, readDependencyContext, invalidateChangedCheck} from '../src/dependencies.ts';
import {configuredFixture, readyChangeFixture, snapshot} from './helpers/project.ts';
import {createChange} from '../src/create.ts';
import {closeChange} from '../src/close.ts';
import {readRegistry, writeRegistry} from '../src/state.ts';

const example = new URL('../docs/examples/story-dependencies/epics.md', import.meta.url);
const document = (fields: Record<string, string | null>) => {
  let epic = '', text = '# Epics\n';
  for (const [id, value] of Object.entries(fields)) {
    if (epic !== id.split('.')[0]) {epic = id.split('.')[0]; text += `\n## Epic ${epic}: Epic\n`;}
    text += `\n### Story ${id}: Название ${id}\n\n${value === null ? '' : `**Dependencies:** ${value}\n`}\n`;
  }
  return text;
};
const parse = (value: string) => parseDependencyField(parseBacklog(document({'1.1': value}))[0], 'epics.md');
async function setGraph(f: Awaited<ReturnType<typeof configuredFixture>>, fields: Record<string, string | null>, statuses: Record<string, string> = {}) {
  await writeFile(path.join(f.root, f.paths.epics), document(fields));
  await writeFile(path.join(f.root, f.paths.sprintStatus), `development_status:\n${Object.keys(fields).map(id => `  ${id.replace('.', '-')}-story: ${statuses[id] ?? 'backlog'}\n`).join('')}`);
}

test('closed grammar: every supported form and full-value rejection', () => {
  for (const word of ['нет', 'отсутствуют', 'none', 'нет зависимостей между stories']) for (const suffix of ['', '.']) {
    const row = parse(word + suffix); assert.equal(row.extractionState, 'known'); assert.deepEqual(row.dependsOn, []);
  }
  for (const [value, ids] of [
    ['Story 2.1', ['2.1']], ['Story 2.1.', ['2.1']], ['Story 2.1, Story 1.2', ['1.2', '2.1']], ['Story 2.1, Story 1.2.', ['1.2', '2.1']],
    ['Story 2.1; будущих stories нет.', ['2.1']], ['Story 2.1, Story 1.2; будущих stories нет.', ['1.2', '2.1']],
    ['только существующий движок и интерфейс; Story 1.2 для завершения этой story не требуется.', []]
  ] as [string, string[]][]) assert.deepEqual(parse(value).dependsOn, ids, value);
  for (const value of ['', 'Story 1.2 не требуется', 'Story 1.2 не требуется.', 'Story 2.1; возможно, ещё авторизация',
    'Story 2.1 и Story 1.2', 'Story 2.1, 1.2', 'none; Story 2.1', '- Story 2.1\n- Story 1.2', 'Story 0.1', 'Story 1.02',
    'Story 2.1; будущих stories нет', 'Нет', 'story 2.1', 'только существующий движок и интерфейс']) {
    const row = parse(value); assert.equal(row.extractionState, 'unknown', value); assert.equal(row.dependsOn, null);
    assert.equal(row.issues[0].fields, row.fields);
  }
});

test('field boundaries, labels, paragraphs, line numbers and ignored Markdown', async () => {
  for (const label of ['**Зависимости:**', '**Зависимости**:', '**Dependencies:**', '**dEpEnDeNcIeS**:', '**ЗАВИСИМОСТИ:**']) {
    const raw = `---\ndependencies: pass\n### Story 9.1: fake\n---\n## Epic 1: A\n**Dependencies:** Story 9.9\n### Story 1.1: A\n\n${label} Story 1.2,\n Story 2.1.\n**Объём:** Something\n\nStory 9.9 is mentioned\n\n~~~markdown\n**Dependencies:** Story 9.9\n### Story 9.9: fake\n~~~\n### Story 1.2: B\n**Dependencies:** none\n## Epic 2: B\n### Story 2.1: C\n**Dependencies:** none\n`;
    const {report} = extractDependencyGraph(raw, 'epics.md');
    assert.deepEqual(report.stories.map(s => s.storyId), ['1.1', '1.2', '2.1']);
    assert.deepEqual(report.stories[0].dependsOn, ['1.2', '2.1']);
    assert.equal(report.stories[0].fields[0].line, 9);
    assert.equal(report.stories[0].fields[0].value, 'Story 1.2,\n Story 2.1.');
  }
  const missing = extractDependencyGraph(document({'1.1': null}), 'epics.md').report.stories[0];
  assert.equal(missing.extractionState, 'unknown'); assert.equal(missing.dependsOn, null);
  for (const second of ['none', 'Story 1.2']) {
    const row = parse(`none\n\n**Зависимости**: ${second}`);
    assert.equal(row.extractionState, 'unknown'); assert.equal(row.fields.length, 2);
    assert.equal(row.issues[0].code, 'DEPENDENCIES_FIELD_AMBIGUOUS');
  }
});

test('standalone example is the regression fixture, including negation and epic order', async () => {
  const raw = await readFile(example, 'utf8');
  const {report} = extractDependencyGraph(raw, 'epics.md');
  assert.deepEqual(report.stories.map(s => [s.storyId, s.extractionState, s.dependsOn]), [['1.1', 'known', []], ['1.2', 'known', ['1.1']]]);
  assert.equal(report.source.sha256, createHash('sha256').update(raw).digest('hex'));
});

test('graph validates missing IDs, duplicate edges, self-reference, duplicate stories and cross-epic cycles', () => {
  for (const [value, code] of [['Story 9.1', 'DEPENDENCY_STORY_MISSING'], ['Story 1.1', 'DEPENDENCY_SELF_REFERENCE'], ['Story 1.2, Story 1.2', 'DEPENDENCY_DUPLICATE']]) {
    const row = extractDependencyGraph(document({'1.1': value, '1.2': 'none'}), 'epics.md').report.stories[0];
    assert.equal(row.extractionState, 'invalid'); assert.ok(row.issues.some(i => i.code === code));
  }
  const cycle = extractDependencyGraph(document({'1.1': 'Story 2.1', '1.2': null, '2.1': 'Story 1.1'}), 'epics.md').report;
  assert.deepEqual(cycle.stories[0].issues[0].chain, ['1.1', '2.1', '1.1']);
  assert.equal(cycle.stories[1].extractionState, 'unknown'); assert.equal(cycle.stories[2].extractionState, 'invalid');
  assert.throws(() => extractDependencyGraph(document({'1.1': 'none'}) + '\n### Story 1.1: Duplicate\n', 'epics.md'), {code: 'INVALID_BACKLOG'});
});

test('extract reads only current backlog bytes, never writes graph, metadata or lock', async t => {
  const f = await configuredFixture(t);
  await writeFile(path.join(f.root, f.paths.epics), await readFile(example));
  await rm(path.join(f.root, f.paths.sprintStatus));
  await writeFile(path.join(f.root, '.mad-openspec/registry.json'), '{broken');
  const before = await snapshot(f.root);
  assert.deepEqual((await extractDependencies(f.project)).stories.map(s => s.dependsOn), [[], ['1.1']]);
  assert.deepEqual(await snapshot(f.root), before);
  await writeFile(path.join(f.root, f.paths.epics), document({'1.1': 'none', '1.2': 'Story 1.1; unknown tail'}));
  const changed = await extractDependencies(f.project);
  assert.equal(changed.stories[1].extractionState, 'unknown'); assert.equal(changed.stories[1].dependsOn, null);
  assert.notEqual(changed.source.sha256, (await extractDependencyGraph(await readFile(example, 'utf8'), 'epics.md')).report.source.sha256);
});

test('closure: shared prerequisite, shortest chains, order and traversal through done', async t => {
  const f = await configuredFixture(t);
  await setGraph(f, {'1.1': 'none', '1.2': 'Story 1.1', '1.3': 'Story 1.1', '2.1': 'Story 1.2, Story 1.3, Story 1.1'}, {'1.2': 'done'});
  const report = await checkDependencies(f.project, '2.1');
  assert.equal(report.dependencyState, 'blocked');
  assert.deepEqual(report.blockedBy.map(b => b.storyId), ['1.1', '1.3']);
  assert.deepEqual(report.blockedBy[0].chain, ['2.1', '1.1']);
  assert.equal(report.blockedBy[0].title, 'Название 1.1');
  await setGraph(f, {'1.1': 'none', '1.2': 'Story 1.1', '2.1': 'Story 1.2'}, {'1.2': 'done'});
  const transitive = await checkDependencies(f.project, '2.1');
  assert.deepEqual(transitive.blockedBy[0].chain, ['2.1', '1.2', '1.1']);
  await setGraph(f, {'1.1': null, '1.2': 'Story 1.1', '2.1': 'Story 1.2'}, {'1.1': 'done', '1.2': 'done'});
  assert.equal((await checkDependencies(f.project, '2.1')).dependencyState, 'unknown');
});

test('local states preserve independent branches and prioritize invalid over unknown over blocked', async t => {
  const f = await configuredFixture(t);
  for (const foreign of [null, 'Story 1.1 не требуется', 'Story 9.1', 'Story 2.1']) {
    await setGraph(f, {'1.1': 'none', '1.2': foreign, '2.1': 'Story 1.2'});
    assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'ready');
    assert.notEqual((await checkDependencies(f.project, '2.1')).dependencyState, 'ready');
  }
  await setGraph(f, {'1.1': null, '1.2': 'Story 9.1', '2.1': 'Story 1.1, Story 1.2'});
  assert.equal((await checkDependencies(f.project, '2.1')).dependencyState, 'invalid');
  assert.equal((await checkDependencies(f.project, '8.1')).dependencyState, 'invalid');
});

test('completion: unique unlinked done, review, invalid status/key, corrupt or missing sources', async t => {
  const f = await configuredFixture(t);
  for (const status of ['backlog', 'ready-for-dev', 'in-progress', 'review', 'done', 'invented']) {
    await setGraph(f, {'1.1': 'none', '1.2': 'Story 1.1'}, {'1.1': status});
    assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, status === 'done' ? 'ready' : status === 'invented' ? 'unknown' : 'blocked');
  }
  await writeFile(path.join(f.root, f.paths.sprintStatus), 'development_status:\n  1-1-a: done\n  1-1-b: done\n');
  assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, 'unknown');
  await writeFile(path.join(f.root, f.paths.sprintStatus), '{broken');
  assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, 'unknown');
  await setGraph(f, {'1.1': 'none', '1.2': 'Story 1.1'}, {'1.1': 'done'});
  await writeFile(path.join(f.root, '.mad-openspec/registry.json'), '{broken');
  assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, 'unknown');
  await rm(path.join(f.root, '.mad-openspec/registry.json'));
  assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, 'ready');
  await rm(path.join(f.root, f.paths.epics));
  assert.equal((await checkDependencies(f.project, '1.2')).dependencyState, 'unknown');
});

test('linked completion requires closed, receipt, archive, marker, BMAD and registered story file', async t => {
  const f = await readyChangeFixture(t);
  await setGraph(f, {'1.1': 'Story 1.2', '1.2': 'none'});
  // Preserve registered sprint key for 1.2.
  const sprint = path.join(f.root, f.paths.sprintStatus);
  await writeFile(sprint, (await readFile(sprint, 'utf8')).replace('1-2-story:', '1-2-invite-member:'));
  const registry = await readRegistry(f.root);
  for (const phase of ['creating', 'active', 'archiving', 'archived', 'recovery-required'] as const) {
    registry.stories['1.2'].phase = phase; await writeRegistry(f.root, registry);
    assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'blocked', phase);
  }
  registry.stories['1.2'].phase = 'active'; await writeRegistry(f.root, registry);
  await closeChange(f.project, 'story-1-2', f.adapter);
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'ready');
  await writeFile(path.join(f.root, 'openspec/specs/invitations/spec.md'), '# Changed by a subsequent change\n');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'ready');
  const closed = await readRegistry(f.root), link = closed.stories['1.2'];
  const registryFile = path.join(f.root, '.mad-openspec/registry.json');
  const goodRegistry = await readFile(registryFile, 'utf8');
  for (const mutate of [() => {link.receipt = null;}, () => {link.receipt!.tasks.remaining = 1;}, () => {link.statusKey = '1-2-wrong';}, () => {link.storyFile = 'planning/story.md';}]) {
    Object.assign(link, JSON.parse(goodRegistry).stories['1.2']);
    mutate(); await writeRegistry(f.root, closed);
    assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
  }
  Object.assign(link, JSON.parse(goodRegistry).stories['1.2']);
  link.storyFile = 'planning/story.md';
  await writeRegistry(f.root, closed);
  await writeFile(path.join(f.root, link.storyFile), 'Status: review\n');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
  await writeFile(path.join(f.root, link.storyFile), 'Status: done\n');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'ready');
  await writeFile(path.join(f.root, link.storyFile), 'Status: done\nStatus: done\n');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
  await writeFile(registryFile, goodRegistry);
  await writeFile(sprint, (await readFile(sprint, 'utf8')).replace('done', 'review'));
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
  await writeFile(sprint, (await readFile(sprint, 'utf8')).replace('review', 'done'));
  const archive = path.join(f.root, JSON.parse(goodRegistry).stories['1.2'].archivePath);
  const markerFile = path.join(archive, '.mad-openspec-link.json');
  const marker = await readFile(markerFile);
  await writeFile(markerFile, '{}');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
  await writeFile(markerFile, marker);
  await writeFile(path.join(archive, 'tasks.md'), 'corrupted archive');
  assert.equal((await checkDependencies(f.project, '1.1')).dependencyState, 'unknown');
});

test('source changes invalidate the snapshot, including initially absent registry', async t => {
  const f = await configuredFixture(t);
  for (const file of [f.paths.epics, f.paths.sprintStatus, '.mad-openspec/registry.json']) {
    const context = await readDependencyContext(f.project);
    const result = await context.check('1.1'); assert.equal(result.dependencyState, 'ready');
    let before: string | null = null;
    try {before = await readFile(path.join(f.root, file), 'utf8');} catch {}
    await writeFile(path.join(f.root, file), before === null ? '{"schemaVersion":1,"stories":{}}' : before + '\n');
    invalidateChangedCheck(result, await context.verifyUnchanged());
    assert.equal(result.dependencyState, 'unknown'); assert.ok(result.issues.some(i => i.code === 'SOURCE_CHANGED' && i.path === file));
    if (before === null) await rm(path.join(f.root, file)); else await writeFile(path.join(f.root, file), before);
  }
});

test('create, refinement identity and close/recovery remain available with unknown/invalid fields', async t => {
  const f = await configuredFixture(t);
  const epics = path.join(f.root, f.paths.epics), original = await readFile(epics, 'utf8');
  await writeFile(epics, original.replaceAll('**Dependencies:** none', '**Dependencies:** unsupported'));
  const link = await createChange(f.project, {storyId: '1.2', input: f.input}, f.adapter);
  const changeDir = path.join(f.root, 'openspec/changes', link.changeId);
  await writeFile(path.join(changeDir, 'design.md'), '# Design\n');
  const tasks = path.join(changeDir, 'tasks.md'); await writeFile(tasks, (await readFile(tasks, 'utf8')).replaceAll('[ ]', '[x]'));
  const before = await snapshot(changeDir);
  await writeFile(epics, original.replaceAll('**Dependencies:** none', '**Dependencies:** Story 9.1'));
  assert.deepEqual(await createChange(f.project, {storyId: '1.2', input: f.input}, f.adapter), link);
  assert.deepEqual(await snapshot(changeDir), before);
  const sprint = path.join(f.root, f.paths.sprintStatus), oldSprint = await readFile(sprint, 'utf8'), archive = f.adapter.archive;
  f.adapter.archive = async id => {const result = await archive(id); await writeFile(sprint, '{broken'); return result;};
  await assert.rejects(closeChange(f.project, link.changeId, f.adapter));
  assert.equal((await readRegistry(f.root)).stories['1.2'].phase, 'archived');
  await writeFile(sprint, oldSprint);
  await closeChange(f.project, link.changeId, f.adapter);
  assert.equal((await readRegistry(f.root)).stories['1.2'].phase, 'closed');
  const closed = await snapshot(f.root); await closeChange(f.project, link.changeId, f.adapter); assert.deepEqual(await snapshot(f.root), closed);
});
