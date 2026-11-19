import {asError} from './errors.ts';
import type {Project, ProjectConfig, ProjectPaths, OpenSpec} from './types.ts';
import path from 'node:path';
import {realpath, readFile, lstat} from 'node:fs/promises';
import {CliError} from './errors.ts';
import {parseDocument} from 'yaml';
import {atomicWrite, withProjectLock, canonicalHash} from './state.ts';
import {checkSetupVersion, checkVersion, cliVersion} from './version.ts';
import {readBacklog, readSprint} from './bmad.ts';

export function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Check the closest existing ancestor, including symlink targets of missing leaves.
export async function assertWritablePath(root: string, target: string) {
  const base = path.resolve(root);
  const absolute = path.resolve(base, target);
  const fail = () => {throw new CliError('UNSAFE_PATH', `Путь выходит из проекта: ${target}`, {path: target});};
  if (!isWithin(base, absolute)) fail();
  const physicalRoot = await realpath(base);
  let ancestor = absolute;
  while (true) {
    try {
      await lstat(ancestor);
      if (!isWithin(physicalRoot, await realpath(ancestor))) fail();
      break;
    } catch (caught) {const error = asError(caught);
      if (error.code !== 'ENOENT') throw error;
      // A dangling symlink is not a nonexistent leaf to be filled in.
      try { if ((await lstat(ancestor)).isSymbolicLink()) fail(); } catch (caught) {const e = asError(caught); if (e.code !== 'ENOENT') throw e; }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) fail();
      ancestor = parent;
    }
  }
  return absolute;
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  root = await realpath(root);
  const file = await assertWritablePath(root, '.mad-openspec/config.json');
  let value;
  try {value = JSON.parse(await readFile(file, 'utf8'));}
  catch (caught) {const error = asError(caught);throw new CliError(error.code === 'ENOENT' ? 'PROJECT_NOT_INITIALIZED' : 'INVALID_CONFIG', `Не удалось прочитать конфигурацию: ${file}`, {path: file});}
  const strings = [value?.bmad?.manifest, value?.bmad?.epics, value?.bmad?.sprintStatus, value?.openspec?.root];
  if (![1, 2].includes(value?.schemaVersion) || (value?.madOpenSpecVersion !== undefined && (typeof value.madOpenSpecVersion !== 'string' || !value.madOpenSpecVersion.trim())) || strings.some(x => typeof x !== 'string' || !x) || value.bmad.version !== '6.12.4' || value.openspec.version !== '1.16.0' || value.openspec.schema !== 'spec-driven') {
    throw new CliError('INVALID_CONFIG', 'Неверная конфигурация MadOpenSpec', {path: file});
  }
  for (const rel of strings) {
    if (path.isAbsolute(rel)) throw new CliError('INVALID_CONFIG', 'Пути конфигурации должны быть относительными', {path: rel});
    await assertWritablePath(root, rel);
  }
  return value;
}

export async function loadConfig(root: string): Promise<ProjectConfig> {
  root = await realpath(root);
  const value = await readProjectConfig(root);
  checkVersion(value.madOpenSpecVersion ?? null);
  await checkSetupVersion(root);
  value.openspec.root = path.relative(root, await realpath(path.resolve(root, value.openspec.root))) || '.';
  return value;
}

async function checkProject(project: Project, openspec: OpenSpec) {
  const {root, config} = project;
  for (const file of [config.bmad.manifest, config.bmad.epics, config.bmad.sprintStatus]) await assertWritablePath(root, file);
  const manifestDoc = parseDocument(await readFile(path.resolve(root, config.bmad.manifest), 'utf8'));
  if (manifestDoc.errors.length) throw new CliError('INVALID_BMAD_MANIFEST', 'Неверный YAML manifest BMAD');
  if (manifestDoc.getIn(['installation', 'version']) !== '6.12.4') throw new CliError('UNSUPPORTED_VERSION', 'Требуется BMAD v6.12.4');
  if (await openspec.version() !== '1.16.0') throw new CliError('UNSUPPORTED_VERSION', 'Требуется OpenSpec 1.16.0');
  const expected = await realpath(path.resolve(root, config.openspec.root));
  const context = await openspec.context();
  if (context?.root?.source !== 'nearest' || !context.root.path || await realpath(context.root.path) !== expected) throw new CliError('UNSUPPORTED_OPENSPEC_ROOT', 'Внешние stores и перенаправленные OpenSpec roots не поддерживаются');
  await assertWritablePath(root, path.resolve(root, config.openspec.root, 'openspec'));
  const doc = parseDocument(await readFile(path.join(expected, 'openspec/config.yaml'), 'utf8'));
  if (doc.errors.length || doc.has('store') || (doc.get('schema') ?? 'spec-driven') !== 'spec-driven') throw new CliError('UNSUPPORTED_SCHEMA', 'Требуется локальная spec-driven schema без store');
  await openspec.schema();
  await readBacklog(path.resolve(root, config.bmad.epics));
  await readSprint(path.resolve(root, config.bmad.sprintStatus));
  return project;
}

export async function initProject(root: string, options: ProjectPaths, openspec: OpenSpec) {
  root = path.resolve(root);
  const relative = async (key: keyof ProjectPaths) => {
    if (typeof options[key] !== 'string' || !options[key]) throw new CliError('INVALID_CONFIG', `Не задан путь ${key}`);
    const file = await assertWritablePath(root, options[key]);
    if (key === 'openspecRoot') return path.relative(await realpath(root), await realpath(file)) || '.';
    return path.relative(root, file) || '.';
  };
  const config = {schemaVersion: 2, madOpenSpecVersion: cliVersion, bmad: {version: '6.12.4', manifest: await relative('manifest'), epics: await relative('epics'), sprintStatus: await relative('sprintStatus')}, openspec: {version: '1.16.0', root: await relative('openspecRoot'), schema: 'spec-driven'}};
  root = await realpath(root);
  return withProjectLock(root, async () => {
    await checkSetupVersion(root);
    await checkProject({root, config}, openspec);
    try {
      const existing = await loadConfig(root);
      if (canonicalHash(existing) !== canonicalHash(config)) throw new CliError('CONFIG_ALREADY_EXISTS', 'Конфигурация уже существует с другими значениями');
    } catch (caught) {const error = asError(caught);
      if (error.code !== 'PROJECT_NOT_INITIALIZED') throw error;
      await atomicWrite(root, '.mad-openspec/config.json', `${JSON.stringify(config, null, 2)}\n`);
    }
    return {root, config};
  });
}

export async function loadProject(root: string, openspec: OpenSpec) {
  root = await realpath(root);
  return checkProject({root, config: await loadConfig(root)}, openspec);
}
