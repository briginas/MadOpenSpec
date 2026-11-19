import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {makeProjectFixture} from './helpers/project.ts';
const bmad = await import('../src/bmad.ts');

test('parse-selected-story', async t => {
  const {root, paths} = await makeProjectFixture(t);
  assert.equal(typeof bmad.readBacklog, 'function');
  const stories = await bmad.readBacklog(path.join(root, paths.epics));
  assert.deepEqual(stories.map(s => s.id), ['1.1', '1.2']);
  assert.equal(stories[1].title, 'Пригласить участника');
  assert.match(stories[1].text, /приглашение видно/);
  assert.doesNotMatch(stories[1].text, /Epic 2/);
  await writeFile(path.join(root, paths.epics), '## Epic 1: x\n### Story 1.2: x\n### Story 1.2: y\n');
  await assert.rejects(bmad.readBacklog(path.join(root, paths.epics)), {code: 'INVALID_BACKLOG'});
});
test('ambiguous-status-key', async t => {
  const {root, paths} = await makeProjectFixture(t);
  assert.equal(typeof bmad.resolveStatusKey, 'function');
  const file = path.join(root, paths.sprintStatus);
  assert.equal(await bmad.resolveStatusKey(file, '1.2'), '1-2-invite-member');
  await writeFile(file, 'development_status:\n  1-2-a: backlog\n  1-2-b: backlog\n');
  await assert.rejects(bmad.resolveStatusKey(file, '1.2'), {code: 'AMBIGUOUS_STORY_STATUS'});
});
test('complete-preserves-yaml', async t => {
  const {root, paths} = await makeProjectFixture(t);
  const file = path.join(root, paths.sprintStatus);
  const before = await readFile(file, 'utf8');
  await writeFile(path.join(root, 'planning/story.md'), '# Story\nStatus: ready-for-dev\n\n## Tasks\n- [ ] leave intact\n');
  const link = {statusKey: '1-2-invite-member', storyFile: 'planning/story.md'};
  assert.equal(typeof bmad.completeStory, 'function');
  await bmad.completeStory({root, config: {bmad: paths}}, link, {now: '2026-11-10'});
  assert.equal(await readFile(file, 'utf8'), before.replace('2026-11-09', '2026-11-10').replace('ready-for-dev # selected', 'done # selected'));
  assert.equal(await readFile(path.join(root, 'planning/story.md'), 'utf8'), '# Story\nStatus: done\n\n## Tasks\n- [ ] leave intact\n');
  const completed = await readFile(file, 'utf8');
  await bmad.completeStory({root, config: {bmad: paths}}, link, {now: '2026-11-11'});
  assert.equal(await readFile(file, 'utf8'), completed);
});
test('ambiguous-story-status-is-preflight-error', async t => {
  const {root, paths} = await makeProjectFixture(t);
  const before = await readFile(path.join(root, paths.sprintStatus), 'utf8');
  await writeFile(path.join(root, 'story.md'), 'Status: draft\nStatus: review\n');
  assert.equal(typeof bmad.completeStory, 'function');
  await assert.rejects(bmad.completeStory({root, config: {bmad: paths}}, {statusKey: '1-2-invite-member', storyFile: 'story.md'}), {code: 'INVALID_STORY_FILE'});
  assert.equal(await readFile(path.join(root, paths.sprintStatus), 'utf8'), before);
});

test('backlog document includes empty epics and ignores fenced and frontmatter headings', () => {
  const raw = '---\ntitle: test\n## Epic 8: fake\n---\n```md\n## Epic 9: fake\n```\n## Epic 1: Real\n### Story 1.1: First\ntext\n## Epic 2: Empty\n';
  assert.deepEqual(bmad.parseBacklogDocument(raw).epics, [{id: '1', title: 'Real'}, {id: '2', title: 'Empty'}]);
  assert.equal(bmad.parseBacklogDocument('## Epic 1: Empty').stories.length, 0);
  assert.throws(() => bmad.parseBacklog('## Epic 1: Empty'), {code: 'INVALID_BACKLOG'});
  assert.throws(() => bmad.parseBacklogDocument('## Epic 1: One\n## Epic 1: Again'), {code: 'INVALID_BACKLOG'});
  assert.throws(() => bmad.parseBacklogDocument('## Epic 1: One\n## Other section\n### Story 1.1: Outside'), {code: 'INVALID_BACKLOG'});
});
