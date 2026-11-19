import {CliError} from '../src/errors.ts';
import type {TestContext} from 'node:test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, rename, readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {configuredFixture} from './helpers/project.ts';
const inputModule = await import('../src/input.ts');
const rendering = await import('../src/render.ts');

test('missing-reference-is-preflight-error', async t => {
  const {project, input} = await configuredFixture(t);
  assert.equal(typeof inputModule.validateInput, 'function');
  input.references[0].path = 'missing.md';
  await assert.rejects(inputModule.validateInput(project, '1.2', input), {code: 'INVALID_REFERENCE'});
  input.references[0] = {path: 'planning/prd.md', requirementId: 'FR10'};
  await assert.rejects(inputModule.validateInput(project, '1.2', input), {code: 'INVALID_REFERENCE'});
});
test('all-and-assertions-become-tasks', async t => {
  const {project, input} = await configuredFixture(t);
  assert.equal(typeof inputModule.validateInput, 'function');
  assert.equal(typeof rendering.renderChange, 'function');
  const files = rendering.renderChange(await inputModule.validateInput(project, '1.2', input));
  assert.equal(files.has('design.md'), false);
  const tasks = files.get('tasks.md');
  assert.ok(tasks);
  const delta = files.get('specs/invitations/spec.md');
  assert.ok(delta);
  for (const expected of ['участник получает письмо', 'приглашение видно в списке', 'повторное письмо не отправляется']) {
    assert.equal(tasks.split('\n').filter(line => line.startsWith('- [ ]') && line.includes(expected)).length, 2);
    assert.ok(delta.includes(expected));
  }
  assert.match(files.get('specs/invitations/spec.md')!, /\*\*GIVEN\*\* команда существует/);
  assert.match(files.get('proposal.md')!, /FR1/);
});
test('proposal-links-resolve-special-filenames-without-fragment-or-query', async t => {
  const {root, project, input} = await configuredFixture(t);
  const source = 'planning/Истории #? 50% (v2).md';
  const reference = 'planning/Требования #? 100% (v2).md';
  await rename(path.join(root, project.config.bmad.epics), path.join(root, source));
  await rename(path.join(root, 'planning/prd.md'), path.join(root, reference));
  project.config.bmad.epics = source;
  input.story.source = source;
  input.references[0].path = reference;
  const prepared = await inputModule.validateInput(project, '1.2', input);
  const proposalPath = path.join(root, 'openspec/changes/story-1-2/proposal.md');
  const proposal = rendering.renderChange(prepared).get('proposal.md');
  assert.ok(proposal);
  const links = [...proposal.matchAll(/^- \[[^\]]+\]\(([^)]+)\)$/gm)].map(match => match[1]);
  assert.equal(links.length, 2);
  for (const [index, file] of [source, reference].entries()) {
    const resolved = new URL(links[index], pathToFileURL(proposalPath));
    assert.equal(resolved.hash, '');
    assert.equal(resolved.search, '');
    assert.equal(fileURLToPath(resolved), path.join(root, file));
    assert.equal(await readFile(resolved, 'utf8'), await readFile(path.join(root, file), 'utf8'));
  }
});
const mainSpec = '# Invitations\n\n## Purpose\n\nУправление приглашениями команды с отправкой писем и отображением статуса.\n\n## Requirements\n\n### Requirement: Старое имя\n\nСистема SHALL приглашать.\n\n#### Scenario: Старый сценарий\n- **WHEN** отправлен запрос\n- **THEN** доставлено письмо\n\n#### Scenario: Ещё сценарий\n- **WHEN** повторный запрос\n- **THEN** повтор не отправлен\n';
async function withMain(t: TestContext) {
  const fixture = await configuredFixture(t);
  await mkdir(path.join(fixture.root, 'openspec/specs/invitations'));
  await writeFile(path.join(fixture.root, 'openspec/specs/invitations/spec.md'), mainSpec);
  return fixture;
}
test('modified-requires-old-scenarios', async t => {
  const {project, input} = await withMain(t);
  const r = input.capabilities[0].requirements[0];
  r.operation = 'MODIFIED'; r.name = 'Старое имя';
  assert.equal(typeof inputModule.validateInput, 'function');
  await assert.rejects(inputModule.validateInput(project, '1.2', input), {code: 'INVALID_INPUT'});
  r.scenarios = ['Старый сценарий', 'Ещё сценарий'].map(name => ({name, when: 'запрос', then: 'результат'}));
  await inputModule.validateInput(project, '1.2', input);
});
test('valid-and-conflicting-operations', async t => {
  const {project, input} = await withMain(t);
  assert.equal(typeof inputModule.validateInput, 'function');
  for (const requirement of [
    {operation: 'REMOVED', name: 'Старое имя', reason: 'Заменено', migration: 'Использовать новое API'},
    {operation: 'RENAMED', from: 'Старое имя', name: 'Новое имя'}
  ]) {
    input.capabilities[0].requirements = [requirement];
    const files = rendering.renderChange(await inputModule.validateInput(project, '1.2', input));
    assert.match(files.get('specs/invitations/spec.md')!, new RegExp(`## ${requirement.operation} Requirements`));
    input.capabilities[0].requirements.push({...requirement});
    await assert.rejects(inputModule.validateInput(project, '1.2', input), {code: 'INVALID_INPUT'});
  }
  input.capabilities[0].requirements = [{operation: 'RENAMED', from: 'Нет такого', name: 'Новое'}];
  await assert.rejects(inputModule.validateInput(project, '1.2', input), {code: 'INVALID_INPUT'});
});
test('rejects-paths-and-markdown-structure', async t => {
  const {project, input} = await configuredFixture(t);
  assert.equal(typeof inputModule.validateInput, 'function');
  for (const unsafe of ['../outside', '/tmp/file', 'a/../../file', 'a\\b', 'x\n## ADDED Requirements']) {
    const value = structuredClone(input); value.capabilities[0].path = unsafe;
    await assert.rejects(inputModule.validateInput(project, '1.2', value), e => e instanceof CliError && ['INVALID_INPUT', 'UNSAFE_PATH'].includes(e.code));
  }
  for (const [field, value] of [['name', 'Норма\n### Requirement: Injected'], ['text', 'Система SHALL работать.\n## REMOVED Requirements']]) {
    const bad = structuredClone(input); bad.capabilities[0].requirements[0][field] = value;
    await assert.rejects(inputModule.validateInput(project, '1.2', bad), {code: 'INVALID_INPUT'});
  }
  const bad = structuredClone(input); bad.capabilities[0].requirements[0].scenarios[0].and.push('- [x] task\n## Tasks');
  await assert.rejects(inputModule.validateInput(project, '1.2', bad), {code: 'INVALID_INPUT'});
});
