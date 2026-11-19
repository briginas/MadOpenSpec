import {asError} from './errors.ts';
import type {Project, StoryLink, OpenSpec} from './types.ts';
import path from 'node:path';
import {readFile, writeFile, mkdir, lstat} from 'node:fs/promises';
import {CliError} from './errors.ts';
import {assertWritablePath, loadProject} from './project.ts';
import {readRegistry, writeRegistry, canonicalHash, withProjectLock} from './state.ts';
import {readSprint, findStatusKey, prepareStoryCompletion} from './bmad.ts';
import {validateInput} from './input.ts';
import {renderChange} from './render.ts';

export const changeDirectory = (project: Project, id: string) => path.resolve(project.root, project.config.openspec.root, 'openspec/changes', id);
export async function exists(file: string) {
  try {await lstat(file); return true;} catch (caught) {const error = asError(caught);if (error.code === 'ENOENT') return false; throw error;}
}
export async function verifyMarker(project: Project, storyId: string, link: StoryLink, directory: string) {
  const file = await assertWritablePath(project.root, path.join(directory, '.mad-openspec-link.json'));
  await assertWritablePath(directory, file);
  let marker;
  try {marker = JSON.parse(await readFile(file, 'utf8'));} catch {throw new CliError('CHANGE_CONFLICT', 'Нет подтверждённого marker связи', {path: file});}
  if (marker.schemaVersion !== 1 || marker.storyId !== storyId || marker.inputHash !== link.inputHash || marker.changeId !== link.changeId || marker.source !== link.source) throw new CliError('CHANGE_CONFLICT', 'Marker не соответствует реестру', {path: file});
  return marker;
}

export async function createChange(project: Project, {storyId, input, storyFile = null}: {storyId: string; input: unknown; storyFile?: string | null}, openspec: OpenSpec) {
  return withProjectLock(project.root, async () => {
    project = await loadProject(project.root, openspec);
    if (!/^[1-9]\d*\.[1-9]\d*$/.test(storyId)) throw new CliError('INVALID_INPUT', 'Неверный ID story');
    const registry = await readRegistry(project.root);
    const inputHash = canonicalHash(input);
    const previous = registry.stories[storyId];
    if (previous) {
      if (inputHash !== previous.inputHash || (storyFile && path.relative(project.root, path.resolve(project.root, storyFile)) !== previous.storyFile)) throw new CliError('STORY_ALREADY_LINKED', `Story уже связана с ${previous.changeId}; дорабатывайте существующий change`);
      if (previous.source !== project.config.bmad.epics) throw new CliError('CHANGE_CONFLICT', 'Исходный backlog связи изменён');
      const directory = previous.archivePath ? path.resolve(project.root, previous.archivePath) : changeDirectory(project, previous.changeId);
      if (previous.phase !== 'creating') {
        await assertWritablePath(project.root, directory);
        await verifyMarker(project, storyId, previous, directory);
        return previous;
      }
    }
    const prepared = await validateInput(project, storyId, input);
    const sprintPath = path.resolve(project.root, project.config.bmad.sprintStatus);
    const sprint = await readSprint(sprintPath);
    const statusKey = findStatusKey(sprint.statuses, storyId);
    if (sprint.statuses[statusKey] === 'done') throw new CliError('STORY_COMPLETED', 'Завершённая story не открывается повторно');
    const changeId = `story-${storyId.replace('.', '-')}`;
    const directory = changeDirectory(project, changeId);
    await assertWritablePath(project.root, directory);
    const present = await exists(directory);
    if (present && !previous) throw new CliError('CHANGE_CONFLICT', `Имя ${changeId} уже занято`);
    const link: StoryLink = previous ?? {source: project.config.bmad.epics, statusKey, storyFile: storyFile ? path.relative(project.root, await assertWritablePath(project.root, storyFile)) : null, changeId, inputHash, phase: 'creating', archivePath: null, receipt: null};
    if (link.statusKey !== statusKey) throw new CliError('CHANGE_CONFLICT', 'Ключ BMAD изменён после создания связи');
    await prepareStoryCompletion(project, link);
    if (present) await verifyMarker(project, storyId, link, directory);
    const files = renderChange(prepared);
    // Validate every destination even when an existing file will be preserved.
    if (present) for (const relative of [...files.keys(), '.openspec.yaml']) await assertWritablePath(directory, relative);
    const sources = [project.config.bmad.epics, project.config.bmad.sprintStatus, project.config.bmad.manifest, ...prepared.references.map(r => r.path)];
    const snapshots = await Promise.all(sources.map(async file => [file, await readFile(path.resolve(project.root, file), 'utf8')] as const));
    if (!previous) {registry.stories[storyId] = link; await writeRegistry(project.root, registry);}
    if (!present) {
      await openspec.create(changeId);
      await assertWritablePath(project.root, directory);
      await writeFile(await assertWritablePath(directory, '.mad-openspec-link.json'), `${JSON.stringify({schemaVersion: 1, storyId, source: link.source, changeId, inputHash}, null, 2)}\n`, {flag: 'wx'});
    }
    const status = await openspec.status(changeId);
    if (status.schemaName !== 'spec-driven') throw new CliError('UNSUPPORTED_SCHEMA', 'Требуется spec-driven schema');
    for (const [file, before] of snapshots) if (await readFile(path.resolve(project.root, file), 'utf8') !== before) throw new CliError('SOURCE_CHANGED', 'Источник изменён другим процессом', {path: file});
    for (const [relative, content] of files) {
      const file = await assertWritablePath(directory, relative);
      if (await exists(file)) continue;
      await mkdir(path.dirname(file), {recursive: true});
      await assertWritablePath(directory, file);
      await writeFile(file, content, {flag: 'wx'});
    }
    link.phase = 'active'; await writeRegistry(project.root, registry);
    return link;
  });
}
