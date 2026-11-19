import {asError} from './errors.ts';
import type {Registry} from './types.ts';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, mkdir, rename, rm, open} from 'node:fs/promises';
import path from 'node:path';
import {assertWritablePath} from './project.ts';
import {CliError} from './errors.ts';

export function canonicalHash(value: unknown) {
  const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical((x as Record<string, unknown>)[k])])) : x;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export async function atomicWrite(root: string, target: string, contents: string) {
  const file = await assertWritablePath(root, target);
  await mkdir(path.dirname(file), {recursive: true});
  await assertWritablePath(root, file);
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, contents, {flag: 'wx'});
    await assertWritablePath(root, file);
    await rename(temporary, file);
  } finally {await rm(temporary, {force: true});}
}

export function validRegistry(value: unknown): value is Registry {
  const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
  return object(value) && value.schemaVersion === 1 && object(value.stories) && Object.entries(value.stories).every(([id, link]) => {
    return /^[1-9]\d*\.[1-9]\d*$/.test(id) && object(link) && ['source', 'statusKey', 'changeId', 'inputHash'].every(k => typeof link[k] === 'string' && link[k]) &&
      link.changeId === `story-${id.replace('.', '-')}` && typeof link.inputHash === 'string' && /^[a-f\d]{64}$/.test(link.inputHash) &&
      (link.storyFile === null || typeof link.storyFile === 'string') && (link.archivePath === null || typeof link.archivePath === 'string') &&
      typeof link.phase === 'string' && ['creating', 'active', 'archiving', 'archived', 'closed', 'recovery-required'].includes(link.phase) &&
      (link.receipt === null || object(link.receipt));
  });
}

export async function readRegistry(root: string): Promise<Registry> {
  const file = await assertWritablePath(root, '.mad-openspec/registry.json');
  let value;
  try {value = JSON.parse(await readFile(file, 'utf8'));}
  catch (caught) {const error = asError(caught);
    if (error.code === 'ENOENT') return {schemaVersion: 1, stories: {}};
    throw new CliError('INVALID_REGISTRY', 'Не удалось прочитать реестр; исходный файл сохранён', {path: file});
  }
  if (!validRegistry(value)) throw new CliError('INVALID_REGISTRY', 'Повреждена структура реестра', {path: file});
  return value;
}

export function parseRegistry(raw: string | null): Registry {
  if (raw === null) return {schemaVersion: 1, stories: {}};
  let value: unknown;
  try {value = JSON.parse(raw);} catch {throw new CliError('INVALID_REGISTRY', 'Не удалось прочитать реестр; исходный файл сохранён');}
  if (!validRegistry(value)) throw new CliError('INVALID_REGISTRY', 'Повреждена структура реестра');
  return value;
}

export async function writeRegistry(root: string, registry: unknown) {
  const content = `${JSON.stringify(registry, null, 2)}\n`;
  if (!validRegistry(registry)) throw new CliError('INVALID_REGISTRY', 'Неверная структура реестра');
  await atomicWrite(root, '.mad-openspec/registry.json', content);
}

export async function withProjectLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const file = await assertWritablePath(root, '.mad-openspec/write.lock');
  await mkdir(path.dirname(file), {recursive: true});
  let handle;
  try {handle = await open(file, 'wx');}
  catch (caught) {const error = asError(caught);
    if (error.code === 'EEXIST') throw new CliError('PROJECT_LOCKED', 'Проект занят. Проверьте PID в write.lock; удаляйте lock вручную только после подтверждения, что процесс завершён.', {path: file});
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    return await action();
  } finally {await handle.close(); await rm(file, {force: true});}
}
