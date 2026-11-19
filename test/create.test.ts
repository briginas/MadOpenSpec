import type {TestContext} from 'node:test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, access, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import {configuredFixture, snapshot, makeProjectFixture} from './helpers/project.ts';
import {readRegistry, writeRegistry} from '../src/state.ts';
const mod = await import('../src/create.ts');

export async function createdFixture(t: TestContext) {
  const fixture = await configuredFixture(t);
  assert.equal(typeof mod.createChange, 'function');
  const link = await mod.createChange(fixture.project, {storyId: '1.2', input: fixture.input}, fixture.adapter);
  const changeDir = path.join(fixture.root, 'openspec/changes', link.changeId);
  return {...fixture, link, changeDir};
}
test('one-story-only', async t => {
  const {root, link, changeDir} = await createdFixture(t);
  assert.equal(link.phase, 'active');
  assert.equal(link.changeId, 'story-1-2');
  assert.deepEqual(Object.keys((await readRegistry(root)).stories), ['1.2']);
  assert.match(await readFile(path.join(changeDir, 'proposal.md'), 'utf8'), /Story 1.2/);
  await assert.rejects(access(path.join(root, 'openspec/changes/story-1-1')));
});
test('invalid-input-does-not-create', async t => {
  const {project, input, adapter, root} = await configuredFixture(t);
  input.references[0].path = 'missing.md';
  assert.equal(typeof mod.createChange, 'function');
  await assert.rejects(mod.createChange(project, {storyId: '1.2', input}, adapter), {code: 'INVALID_REFERENCE'});
  assert.equal(adapter.calls.some(([method]) => method === 'create'), false);
  await assert.rejects(access(path.join(root, 'openspec/changes/story-1-2')));
});
test('repeat-preserves-edits', async t => {
  const {root, input, project, adapter, changeDir} = await createdFixture(t);
  await writeFile(path.join(changeDir, 'tasks.md'), '# Tasks\n- [ ] Авторская задача\n');
  await writeFile(path.join(changeDir, 'design.md'), '# Design\nАвторское решение\n');
  const before = await snapshot(root);
  await mod.createChange(project, {storyId: '1.2', input}, adapter);
  assert.deepEqual(await snapshot(root), before);
  input.why = 'Другая версия';
  await assert.rejects(mod.createChange(project, {storyId: '1.2', input}, adapter), {code: 'STORY_ALREADY_LINKED'});
  assert.deepEqual(await snapshot(root), before);
});
test('foreign-directory-is-not-adopted', async t => {
  const {root, project, input, adapter} = await configuredFixture(t);
  const changeDir = path.join(root, 'openspec/changes/story-1-2');
  await mkdir(changeDir); await writeFile(path.join(changeDir, 'proposal.md'), 'чужой файл');
  const before = await snapshot(root);
  assert.equal(typeof mod.createChange, 'function');
  await assert.rejects(mod.createChange(project, {storyId: '1.2', input}, adapter), {code: 'CHANGE_CONFLICT'});
  assert.deepEqual(await snapshot(root), before);
});
test('resume-own-partial-create', async t => {
  const {root, project, input, adapter, changeDir} = await createdFixture(t);
  const registry = await readRegistry(root); registry.stories['1.2'].phase = 'creating';
  await writeRegistry(root, registry);
  await rm(path.join(changeDir, 'tasks.md'));
  await writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\nДоработано вручную\n');
  const link = await mod.createChange(project, {storyId: '1.2', input}, adapter);
  assert.equal(link.phase, 'active');
  assert.match(await readFile(path.join(changeDir, 'tasks.md'), 'utf8'), /\[ \]/);
  assert.equal(await readFile(path.join(changeDir, 'proposal.md'), 'utf8'), '# Proposal\nДоработано вручную\n');
  assert.equal(adapter.calls.filter(([method]) => method === 'create').length, 1);
});
test('symlink-artifact-cannot-overwrite-bmad', async t => {
  const {root, project, input, adapter, changeDir} = await createdFixture(t);
  const registry = await readRegistry(root); registry.stories['1.2'].phase = 'creating';
  await writeRegistry(root, registry);
  await rm(path.join(changeDir, 'tasks.md'));
  const {root: outside} = await makeProjectFixture(t);
  await symlink(outside, path.join(changeDir, 'tasks.md'));
  await assert.rejects(mod.createChange(project, {storyId: '1.2', input}, adapter), {code: 'UNSAFE_PATH'});
});
test('create generates English change documents from English input', async t => {
  const {root, project, input, adapter} = await configuredFixture(t);
  input.title = 'Invite a member';
  input.why = 'Team owners need to invite members by email.';
  input.references = [{path: 'planning/prd.md'}];
  input.capabilities = [{
    path: 'invitations',
    purpose: 'Allow a team owner to invite new members by email and track pending invitations.',
    requirements: [{
      operation: 'ADDED',
      name: 'Member invitations',
      text: 'The system SHALL send an invitation by email.',
      scenarios: [{name: 'Send an invitation', when: 'the owner invites a member', then: 'the member receives an email'}],
    }],
  }];

  const link = await mod.createChange(project, {storyId: '1.2', input}, adapter);
  const docs = await snapshot(path.join(root, 'openspec/changes', link.changeId));
  const proposal = docs['proposal.md'];
  const delta = docs['specs/invitations/spec.md'];
  const tasks = docs['tasks.md'];
  assert.match(proposal, /This change implements Story 1\.2\./);
  assert.match(proposal, /### Modified Capabilities\n\nNone\./);
  assert.match(proposal, /\[Source\]\(\.\.\/\.\.\/\.\.\/planning\/prd\.md\)/);
  assert.match(delta, /The system SHALL send an invitation by email\./);
  assert.match(tasks, /1\.1 Implement “the member receives an email”/);
  assert.match(tasks, /1\.2 Verify “the member receives an email”/);
  for (const document of [proposal, delta, tasks]) assert.doesNotMatch(document, /\p{Script=Cyrillic}/u);
});

test('create preserves non-English literals in requirements, scenarios, and custom tasks', async t => {
  const {root, project, input, adapter} = await configuredFixture(t);
  const literal = '«Приглашение  отправлено»';
  const requirement = input.capabilities[0].requirements[0];
  requirement.text = `The confirmation SHALL read ${literal}.`;
  const outcome = `the owner sees ${literal}  `;
  requirement.scenarios[0].and = [outcome];
  input.tasks = [`Check the exact wording ${literal}`];

  const link = await mod.createChange(project, {storyId: '1.2', input}, adapter);
  const docs = await snapshot(path.join(root, 'openspec/changes', link.changeId));
  const delta = docs['specs/invitations/spec.md'];
  assert.ok(delta.includes(`\n${requirement.text}\n`));
  assert.ok(delta.includes(`- **AND** ${outcome}\n`));
  assert.ok(docs['tasks.md'].includes(`- [ ] 1.1 ${input.tasks[0]}\n`));
});
