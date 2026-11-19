import type {TestContext} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm, readdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function makeProjectFixture(t: TestContext, overrides: {prefix?: string; openspec?: boolean} = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), overrides.prefix ?? 'mad-project-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = {epics: 'planning/epics.md', sprintStatus: 'planning/sprint-status.yaml', manifest: '_bmad/_config/manifest.yaml', openspecRoot: '.'};
  await mkdir(path.join(root, 'planning'), {recursive: true});
  await mkdir(path.join(root, '_bmad/_config'), {recursive: true});
  if (overrides.openspec !== false) {
    await mkdir(path.join(root, 'openspec/specs'), {recursive: true});
    await mkdir(path.join(root, 'openspec/changes'), {recursive: true});
  }
  await writeFile(path.join(root, paths.epics), '# Epics\n\n## Requirements Inventory\n\n### Functional Requirements\n\nFR1: Приглашение участника.\n\n## Epic 1: Команда\n\n### Story 1.1: Создать команду\n\nAs a user, I want a team.\n\n**Dependencies:** none\n\n### Story 1.2: Пригласить участника\n\nAs an owner, I want to invite a member.\n\n**Dependencies:** none\n\n**Acceptance Criteria:**\n\n**Given** команда существует\n**When** отправлено приглашение\n**Then** участник получает письмо\n**And** приглашение видно в списке\n\n## Epic 2: Отчёты\n');
  await writeFile(path.join(root, paths.sprintStatus), '# Sprint comment\nlast_updated: 2026-11-09\ndevelopment_status:\n  epic-1: in-progress # epic stays\n  1-1-create-team: backlog # other story\n  1-2-invite-member: ready-for-dev # selected\n  epic-2: backlog\n');
  await writeFile(path.join(root, paths.manifest), 'installation:\n  version: 6.12.4\n');
  if (overrides.openspec !== false) await writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  await writeFile(path.join(root, 'planning/prd.md'), '# PRD\n\nFR1: Приглашение участника.\n');
  return {root, paths};
}

export async function snapshot(root: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, prefix), {withFileTypes: true})) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(out, await snapshot(root, rel));
    else if (entry.isFile()) out[rel] = await readFile(path.join(root, rel), 'utf8');
  }
  return out;
}

export async function configuredFixture(t: TestContext) {
  const fixture = await makeProjectFixture(t);
  const {fakeOpenSpec} = await import('./openspec.ts');
  const {initProject} = await import('../../src/project.ts');
  const adapter = fakeOpenSpec(fixture.root);
  const project = await initProject(fixture.root, fixture.paths, adapter);
  const input = JSON.parse(await readFile(new URL('../fixtures/change-input.json', import.meta.url), 'utf8'));
  return {...fixture, project, adapter, input};
}

export async function readyChangeFixture(t: TestContext) {
  const fixture = await configuredFixture(t);
  const {createChange} = await import('../../src/create.ts');
  const link = await createChange(fixture.project, {storyId: '1.2', input: fixture.input}, fixture.adapter);
  const changeDir = path.join(fixture.root, 'openspec/changes', link.changeId);
  await writeFile(path.join(changeDir, 'design.md'), '# Design\n\n## Decisions\n\nРеализовать отправку приглашений.\n');
  const tasks = path.join(changeDir, 'tasks.md');
  await writeFile(tasks, (await readFile(tasks, 'utf8')).replaceAll('[ ]', '[x]'));
  return {...fixture, link, changeDir};
}
