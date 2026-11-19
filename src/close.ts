import {asError} from './errors.ts';
import type {Project, StoryLink, OpenSpec, Hashes} from './types.ts';
import path from 'node:path';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CliError} from './errors.ts';
import {assertWritablePath, loadProject, isWithin} from './project.ts';
import {readRegistry, writeRegistry, withProjectLock, canonicalHash} from './state.ts';
import {readBacklog, readSprint, findStatusKey, prepareStoryCompletion, completeStory} from './bmad.ts';
import {changeDirectory, verifyMarker, exists} from './create.ts';
import {archiveSynced} from './openspec.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function hashFile(project: Project, file: string) {
  await assertWritablePath(project.root, file);
  try {return digest(await readFile(file));} catch (caught) {const error = asError(caught);if (error.code === 'ENOENT') return null; throw error;}
}
export async function treeHashes(project: Project, directory: string, prefix = ''): Promise<Record<string, string>> {
  await assertWritablePath(project.root, directory);
  const hashes: Record<string, string> = {};
  for (const entry of (await readdir(path.join(directory, prefix), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    const file = await assertWritablePath(directory, relative);
    if (entry.isSymbolicLink()) throw new CliError('UNSAFE_PATH', 'Символические ссылки внутри change требуют устранения перед archive', {path: file});
    if (entry.isDirectory()) Object.assign(hashes, await treeHashes(project, directory, relative));
    else if (entry.isFile()) hashes[relative] = digest(await readFile(file));
    else throw new CliError('UNSAFE_PATH', 'Неподдерживаемый тип файла в change', {path: file});
  }
  return hashes;
}
async function mainHashes(project: Project, paths: string[]) {
  const hashes: Hashes = {};
  for (const relative of paths) hashes[relative] = await hashFile(project, path.resolve(project.root, relative));
  return hashes;
}
const recovery = () => new CliError('RECOVERY_REQUIRED', 'Результат archive нельзя безопасно подтвердить. Проверьте архив, main specs и журнал .mad-openspec; повторное применение delta остановлено.');

async function mainSpecPath(project: Project, relative: string) {
  const openspecDir = await realpath(path.resolve(project.root, project.config.openspec.root, 'openspec'));
  const specsDir = path.join(openspecDir, 'specs');
  const file = await assertWritablePath(project.root, path.resolve(specsDir, relative));
  if (await exists(specsDir)) {
    if (await realpath(specsDir) !== specsDir) throw new CliError('UNSAFE_PATH', 'Main specs должны находиться внутри openspec/specs');
    await assertWritablePath(specsDir, file);
  }
  return file;
}

async function checkIdentity(project: Project, storyId: string, link: StoryLink) {
  if (link.source !== project.config.bmad.epics || !(await readBacklog(path.resolve(project.root, link.source))).some(s => s.id === storyId)) throw new CliError('CHANGE_CONFLICT', 'Story связи отсутствует в настроенном backlog');
  const sprint = await readSprint(path.resolve(project.root, project.config.bmad.sprintStatus));
  if (findStatusKey(sprint.statuses, storyId) !== link.statusKey) throw new CliError('CHANGE_CONFLICT', 'Ключ статуса story изменён');
}

export async function verifyReceipt(project: Project, storyId: string, link: StoryLink, {checkMain = true} = {}) {
  const receipt = link.receipt;
  if (!receipt?.archive || receipt.archive.change !== link.changeId || !archiveSynced(receipt.archive) || receipt.archive.path !== link.archivePath || !receipt.deltaHashes || !receipt.mainSpecs || !Object.keys(receipt.mainSpecs).length || !link.archivePath) throw recovery();
  const directory = await assertWritablePath(project.root, link.archivePath);
  const archiveRoot = path.resolve(project.root, project.config.openspec.root, 'openspec/changes/archive');
  if (path.dirname(directory) !== archiveRoot || path.basename(directory) !== receipt.archive.archivedAs || await exists(changeDirectory(project, link.changeId))) throw recovery();
  await verifyMarker(project, storyId, link, directory);
  if (canonicalHash(await treeHashes(project, directory)) !== canonicalHash(receipt.deltaHashes)) throw recovery();
  if (checkMain && canonicalHash(await mainHashes(project, Object.keys(receipt.mainSpecs))) !== canonicalHash(receipt.mainSpecs)) throw recovery();
  return directory;
}

async function activePreflight(project: Project, link: StoryLink, openspec: OpenSpec) {
  const directory = changeDirectory(project, link.changeId);
  const status = await openspec.status(link.changeId);
  if (status.schemaName !== 'spec-driven') throw new CliError('UNSUPPORTED_SCHEMA', 'Требуется spec-driven schema');
  for (const key of ['proposal', 'specs', 'design', 'tasks']) {
    const artifact = status.artifacts?.find(a => a.id === key);
    const paths = status.artifactPaths?.[key]?.existingOutputPaths;
    if (artifact?.status !== 'done' || !Array.isArray(paths) || !paths.length) throw new CliError('MISSING_ARTIFACTS', `Не готов обязательный артефакт ${key}`);
    for (const file of paths) {
      await assertWritablePath(directory, file);
      try {await readFile(file);} catch {throw new CliError('MISSING_ARTIFACTS', `Артефакт не читается: ${file}`, {path: file});}
    }
  }
  const tasks = await openspec.tasks(link.changeId);
  if (tasks.total < 1 || tasks.remaining !== 0 || tasks.completed !== tasks.total || tasks.tasks.length !== tasks.total || tasks.tasks.some(t => !t.done)) throw new CliError('INCOMPLETE_TASKS', 'Закройте все задачи; список задач не должен быть пустым', {remaining: tasks.tasks.filter(t => !t.done).map(t => t.description)});
  const validation = await openspec.validate(link.changeId);
  if (validation.valid !== true) throw new CliError('INVALID_OPENSPEC_RESPONSE', 'Строгая валидация не подтверждена');
  const mainPaths = [];
  const requiredMainPaths = [];
  const specsDirectory = path.join(directory, 'specs');
  for (const file of status.artifactPaths.specs.existingOutputPaths) {
    const rel = path.relative(specsDirectory, file).split(path.sep).join('/');
    if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*\/spec\.md$/.test(rel)) throw new CliError('INVALID_DELTA_PATH', `Неподдерживаемый путь delta: ${rel}`);
    const main = await mainSpecPath(project, rel);
    mainPaths.push(path.relative(project.root, main));
    const delta = await readFile(file, 'utf8');
    if (/^## (?:ADDED|MODIFIED|RENAMED) Requirements\s*$/m.test(delta)) requiredMainPaths.push(path.relative(project.root, main));
  }
  await assertWritablePath(project.root, path.resolve(project.root, project.config.openspec.root, 'openspec/changes/archive'));
  return {tasks: {total: tasks.total, completed: tasks.completed, remaining: tasks.remaining}, mainPaths, requiredMainPaths};
}

export async function closeChange(project: Project, changeId: string, openspec: OpenSpec) {
  return withProjectLock(project.root, async () => {
    project = await loadProject(project.root, openspec);
    const registry = await readRegistry(project.root);
    const matches = Object.entries(registry.stories).filter(([, link]) => link.changeId === changeId);
    if (matches.length !== 1) throw new CliError('CHANGE_CONFLICT', `Нет единственной связи для ${changeId}`);
    const [storyId, link] = matches[0];
    await checkIdentity(project, storyId, link);
    if (['archiving', 'recovery-required'].includes(link.phase)) {
      if (link.phase !== 'recovery-required') {link.phase = 'recovery-required'; await writeRegistry(project.root, registry);}
      throw recovery();
    }
    if (link.phase === 'closed') {
      await verifyReceipt(project, storyId, link, {checkMain: false});
      if ((await prepareStoryCompletion(project, link)).length) throw new CliError('INCONSISTENT_COMPLETION', 'Закрытый change не согласован со статусом BMAD');
      return link;
    }
    if (link.phase === 'archived') {
      await verifyReceipt(project, storyId, link);
      await completeStory(project, link);
      link.phase = 'closed'; await writeRegistry(project.root, registry);
      return link;
    }
    if (link.phase !== 'active') throw new CliError('CHANGE_NOT_READY', 'Сначала завершите создание change');
    const directory = changeDirectory(project, changeId);
    await assertWritablePath(project.root, directory);
    await verifyMarker(project, storyId, link, directory);
    const sources = [project.config.bmad.epics, project.config.bmad.sprintStatus, project.config.bmad.manifest, ...(link.storyFile ? [link.storyFile] : [])];
    const sourceHashes = await mainHashes(project, sources);
    await prepareStoryCompletion(project, link);
    const preflight = await activePreflight(project, link, openspec);
    if (canonicalHash(await mainHashes(project, sources)) !== canonicalHash(sourceHashes)) throw new CliError('SOURCE_CHANGED', 'Исходные документы изменены во время проверки');
    const deltaHashes = await treeHashes(project, directory);
    const mainBefore = await mainHashes(project, preflight.mainPaths);
    link.pending = {deltaHashes, mainBefore};
    link.phase = 'archiving'; await writeRegistry(project.root, registry);
    let archive;
    let receipt;
    try {
      archive = await openspec.archive(changeId);
      const archiveRoot = path.resolve(project.root, project.config.openspec.root, 'openspec/changes/archive');
      if (archive?.change !== changeId || !archiveSynced(archive) || !archive.path || !archive.archivedAs || path.dirname(archive.path) !== archiveRoot || path.basename(archive.path) !== archive.archivedAs || !isWithin(archiveRoot, archive.path) || await exists(directory)) throw recovery();
      await assertWritablePath(project.root, archive.path);
      await verifyMarker(project, storyId, link, archive.path);
      if (canonicalHash(await treeHashes(project, archive.path)) !== canonicalHash(deltaHashes)) throw recovery();
      const mainSpecs = await mainHashes(project, preflight.mainPaths);
      if (preflight.requiredMainPaths.some(file => mainSpecs[file] === null)) throw recovery();
      receipt = {archive: {...archive, path: path.relative(project.root, archive.path)}, deltaHashes, mainSpecs, tasks: preflight.tasks};
    } catch (caught) {const error = asError(caught);
      let unchanged = false;
      try {unchanged = await exists(directory) && canonicalHash(await treeHashes(project, directory)) === canonicalHash(deltaHashes) && canonicalHash(await mainHashes(project, preflight.mainPaths)) === canonicalHash(mainBefore);} catch { /* Cannot prove a no-op. */ }
      link.phase = unchanged ? 'active' : 'recovery-required';
      await writeRegistry(project.root, registry);
      if (!unchanged) throw recovery();
      throw error;
    }
    link.archivePath = receipt.archive.path;
    link.receipt = receipt; link.phase = 'archived'; delete link.pending;
    await writeRegistry(project.root, registry);
    await completeStory(project, link);
    link.phase = 'closed'; await writeRegistry(project.root, registry);
    return link;
  });
}
