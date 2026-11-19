import type {Scalar} from 'yaml';
import type {Epic, Project, Story, StoryLink} from './types.ts';
import {readFile} from 'node:fs/promises';
import {parseDocument, isMap, isScalar} from 'yaml';
import {CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';
import {atomicWrite} from './state.ts';

export function withoutFences(text: string) {
  let fence: {char: string; count: number} | null = null;
  return text.split(/\r?\n/).map(line => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = {char: match[1][0], count: match[1].length};
      else if (match[1][0] === fence.char && match[1].length >= fence.count) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

export async function readBacklog(file: string) {
  const raw = await readFile(file, 'utf8');
  return parseBacklog(raw, file);
}

export function parseBacklog(raw: string, file = '') {
  const {stories} = parseBacklogDocument(raw, file);
  if (!stories.length) throw new CliError('INVALID_BACKLOG', 'Не найдены заголовки Epic N / Story N.M', {path: file});
  return stories;
}

export function parseBacklogDocument(raw: string, file = '') {
  const lines = raw.split(/\r?\n/);
  const visible = withoutFences(raw).split('\n');
  if (visible[0]?.trim() === '---') {
    let end = 1;
    while (end < visible.length && !/^(?:---|\.\.\.)\s*$/.test(visible[end])) end++;
    visible.fill('', 0, end + 1);
  }
  const stories: (Story & {title: string; text: string})[] = [];
  const epics: Epic[] = [];
  let epic: string | null = null;
  for (let i = 0; i < visible.length; i++) {
    const header = /^## Epic ([1-9]\d*):\s*(.+)$/.exec(visible[i]);
    if (header) {
      epic = header[1];
      if (epics.some(e => e.id === epic)) throw new CliError('INVALID_BACKLOG', `Повторный epic ${epic}`, {path: file});
      epics.push({id: epic, title: header[2].trim()});
    } else if (/^#{1,2} /.test(visible[i])) epic = null;
    const match = /^### Story ([1-9]\d*\.[1-9]\d*):\s*(.+)$/.exec(visible[i]);
    if (!match) continue;
    if (match[1].split('.')[0] !== epic || stories.some(s => s.id === match[1])) throw new CliError('INVALID_BACKLOG', `Неоднозначная story ${match[1]}`, {path: file});
    let end = i + 1;
    while (end < visible.length && !/^#{1,3} /.test(visible[end])) end++;
    stories.push({id: match[1], title: match[2].trim(), text: lines.slice(i, end).join('\n'), line: i + 1});
  }
  if (!epics.length) throw new CliError('INVALID_BACKLOG', 'Не найдены заголовки Epic N', {path: file});
  return {epics, stories};
}

export async function readSprint(file: string) {
  const raw = await readFile(file, 'utf8');
  return parseSprint(raw, file);
}

export function parseSprint(raw: string, file = '') {
  const doc = parseDocument(raw);
  if (doc.errors.length || !isMap(doc.contents) || !isMap(doc.get('development_status', true))) throw new CliError('INVALID_SPRINT_STATUS', `Неверный sprint-status: ${doc.errors.map(e => e.message).join('; ')}`, {path: file});
  const map = doc.get('development_status', true);
  if (!isMap(map)) throw new CliError('INVALID_SPRINT_STATUS', 'Ожидается development_status map');
  if (map.items.some(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string' || !isScalar(pair.value) || typeof pair.value.value !== 'string')) throw new CliError('INVALID_SPRINT_STATUS', 'Ожидаются строковые ключи и статусы', {path: file});
  return {raw, doc, statuses: Object.fromEntries(map.items.map(pair => [(pair.key as Scalar<string>).value, (pair.value as Scalar<string>).value]))};
}

export function findStatusKey(statuses: Record<string, string>, storyId: string) {
  const prefix = storyId.replace('.', '-');
  const matches = Object.keys(statuses).filter(k => k === prefix || k.startsWith(`${prefix}-`));
  if (matches.length !== 1) throw new CliError('AMBIGUOUS_STORY_STATUS', `Для story ${storyId} найдено ключей статуса: ${matches.length}`);
  return matches[0];
}

export async function resolveStatusKey(sprintPath: string, storyId: string) {
  return findStatusKey((await readSprint(sprintPath)).statuses, storyId);
}

export async function prepareStoryCompletion(project: {root: string; config: {bmad: {sprintStatus: string}}}, link: Pick<StoryLink, 'statusKey' | 'storyFile'>, {now = new Date().toISOString().slice(0, 10)}: {now?: string} = {}) {
  const sprintPath = await assertWritablePath(project.root, project.config.bmad.sprintStatus);
  const {raw, doc, statuses} = await readSprint(sprintPath);
  if (typeof statuses[link.statusKey] !== 'string') throw new CliError('AMBIGUOUS_STORY_STATUS', 'Зарегистрированный ключ BMAD отсутствует');
  const writes = [];
  if (link.storyFile) {
    const file = await assertWritablePath(project.root, link.storyFile);
    const text = await readFile(file, 'utf8');
    const lines = [...text.matchAll(/^Status:[ \t]*([^\r\n]*)(\r?)$/gm)];
    if (lines.length !== 1) throw new CliError('INVALID_STORY_FILE', 'Story-файл должен содержать ровно одну строку Status:', {path: file});
    if (lines[0][1].trim() !== 'done') writes.push({file, before: text, after: text.replace(/^Status:[ \t]*[^\r\n]*(\r?)$/m, 'Status: done$1')});
  }
  if (statuses[link.statusKey] !== 'done') {
    doc.setIn(['development_status', link.statusKey], 'done');
    if (doc.has('last_updated') && !isScalar(doc.get('last_updated', true))) throw new CliError('INVALID_SPRINT_STATUS', 'last_updated должен быть скалярным');
    doc.set('last_updated', String(now));
    writes.unshift({file: sprintPath, before: raw, after: doc.toString()});
  }
  return writes;
}

export async function completeStory(project: {root: string; config: {bmad: {sprintStatus: string}}}, link: Pick<StoryLink, 'statusKey' | 'storyFile'>, options?: {now?: string}) {
  const writes = await prepareStoryCompletion(project, link, options);
  for (const {file, before, after} of writes) {
    if (await readFile(file, 'utf8') !== before) throw new CliError('SOURCE_CHANGED', 'BMAD-документ изменён другим процессом', {path: file});
    await atomicWrite(project.root, file, after);
  }
}
