import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {DependencyCheck, DependencyExtraction, DependencyField, DependencyStory, Epic, Issue, Project, Registry, StatusSource, Story} from './types.ts';
import {parseBacklogDocument, parseSprint, withoutFences, findStatusKey, prepareStoryCompletion} from './bmad.ts';
import {parseRegistry} from './state.ts';
import {assertWritablePath} from './project.ts';
import {CliError, asError, problem} from './errors.ts';
import {verifyReceipt} from './close.ts';

export const compareStoryIds = (a: string, b: string) => a.localeCompare(b, 'en', {numeric: true});
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');

export function parseDependencyField(story: Story, source: string): DependencyStory {
  const lines = withoutFences(story.text ?? '').split(/\r?\n/);
  const fields: DependencyField[] = [];
  const label = /^ {0,3}\*\*(Зависимости|Dependencies)(?::\*\*|\*\*:)[ \t]*(.*)$/iu;
  const boundary = /^(?: {0,3}\*\*[^*]+(?::\*\*|\*\*:)| {0,3}#{1,6}\s)/u;
  for (let i = 0; i < lines.length; i++) {
    const match = label.exec(lines[i]);
    if (!match) continue;
    const value = [match[2]];
    let end = i + 1;
    while (end < lines.length && lines[end].trim() && !boundary.test(lines[end])) value.push(lines[end++]);
    fields.push({label: match[1], line: (story.line ?? 1) + i, value: value.join('\n')});
  }
  const row: DependencyStory = {storyId: story.id, title: story.title, extractionState: 'unknown', dependsOn: null, fields, issues: []};
  const fail = (code: string, message: string) => {
    row.issues.push({code, message, storyId: story.id, path: source, line: fields[0]?.line ?? story.line ?? 1, fields});
    return row;
  };
  if (!fields.length) return fail('DEPENDENCIES_FIELD_MISSING', 'Поле Зависимости / Dependencies отсутствует; уточните его поддерживаемой формой');
  if (fields.length !== 1) return fail('DEPENDENCIES_FIELD_AMBIGUOUS', 'Повторное поле зависимостей; оставьте одно однозначное поле');
  const value = fields[0].value.trim().replace(/\s+/gu, ' ');
  const id = '[1-9]\\d*\\.[1-9]\\d*';
  let ids: string[] | null = null;
  if (/^(?:нет|отсутствуют|none|нет зависимостей между stories)\.?$/u.test(value) ||
    new RegExp(`^только существующий движок и интерфейс; Story ${id} для завершения этой story не требуется\\.$`, 'u').test(value)) ids = [];
  else if (new RegExp(`^Story ${id}(?:, Story ${id})*(?:\\.|; будущих stories нет\\.)?$`, 'u').test(value)) {
    ids = [...value.matchAll(/Story ([1-9]\d*\.[1-9]\d*)/g)].map(match => match[1]);
  }
  if (ids === null) return fail('DEPENDENCIES_FIELD_UNSUPPORTED', 'Значение поля не распознано целиком; уточните его поддерживаемой формой');
  row.extractionState = 'known';
  row.dependsOn = ids.sort(compareStoryIds);
  return row;
}

export function extractDependencyGraph(raw: string, source: string, {allowEmpty = false} = {}): {report: DependencyExtraction; backlog: Story[]; epics: Epic[]} {
  const {stories: backlog, epics} = parseBacklogDocument(raw, source);
  if (!allowEmpty && !backlog.length) throw new CliError('INVALID_BACKLOG', 'Не найдены заголовки Epic N / Story N.M', {path: source});
  const stories = backlog.map(story => parseDependencyField(story, source)).sort((a, b) => compareStoryIds(a.storyId, b.storyId));
  const byId = new Map(stories.map(row => [row.storyId, row]));
  const edges = new Map(stories.map(row => [row.storyId, row.dependsOn ?? []]));
  const invalidate = (id: string, code: string, message: string, details: Record<string, unknown> = {}) => {
    const row = byId.get(id)!;
    row.extractionState = 'invalid';
    row.issues.push({code, message, storyId: id, path: source, line: row.fields[0]?.line, fields: row.fields, ...details});
  };
  for (const row of stories) {
    const seen = new Set<string>();
    for (const dependency of edges.get(row.storyId)!) {
      if (seen.has(dependency)) invalidate(row.storyId, 'DEPENDENCY_DUPLICATE', `Повторная зависимость ${dependency}`, {dependency});
      seen.add(dependency);
      if (!byId.has(dependency)) invalidate(row.storyId, 'DEPENDENCY_STORY_MISSING', `Story ${row.storyId} зависит от отсутствующей story ${dependency}`, {dependency});
      if (dependency === row.storyId) invalidate(row.storyId, 'DEPENDENCY_SELF_REFERENCE', `Story ${row.storyId} зависит от себя`, {chain: [row.storyId, row.storyId]});
    }
  }
  // Strongly connected components identify every story participating in a cycle.
  let index = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>();
  const visit = (id: string) => {
    indices.set(id, index); low.set(id, index++); stack.push(id); onStack.add(id);
    for (const dependency of edges.get(id)!) {
      if (!byId.has(dependency)) continue;
      if (!indices.has(dependency)) {visit(dependency); low.set(id, Math.min(low.get(id)!, low.get(dependency)!));}
      else if (onStack.has(dependency)) low.set(id, Math.min(low.get(id)!, indices.get(dependency)!));
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {member = stack.pop()!; onStack.delete(member); component.push(member);} while (member !== id);
    if (component.length < 2) return;
    component.sort(compareStoryIds);
    const members = new Set(component), start = component[0];
    const cycle = (current: string, path: string[]): string[] | null => {
      for (const dependency of edges.get(current)!) {
        if (dependency === start) return [...path, start];
        if (members.has(dependency) && !path.includes(dependency)) {
          const found = cycle(dependency, [...path, dependency]);
          if (found) return found;
        }
      }
      return null;
    };
    const chain = cycle(start, [start])!;
    for (const memberId of component) invalidate(memberId, 'DEPENDENCY_CYCLE', `Цикл зависимостей: ${chain.join(' -> ')}`, {chain, members: component});
  };
  for (const row of stories) if (!indices.has(row.storyId)) visit(row.storyId);
  for (const row of stories) if (row.extractionState === 'invalid') row.dependsOn = null;
  return {backlog, epics, report: {schemaVersion: 1, source: {path: source, sha256: hash(Buffer.from(raw))}, stories, issues: []}};
}

export function snapshotReader(project: Pick<Project, 'root'>) {
  const snapshots = new Map<string, Buffer | null>();
  const read = async (relative: string, optional = false) => {
    const file = await assertWritablePath(project.root, relative);
    let bytes: Buffer | null;
    try {bytes = await readFile(file);} catch (caught) {if (!optional || asError(caught).code !== 'ENOENT') throw caught; bytes = null;}
    if (!snapshots.has(relative)) snapshots.set(relative, bytes);
    return bytes;
  };
  const verify = async (): Promise<Issue[]> => {
    const issues: Issue[] = [];
    for (const [relative, before] of snapshots) {
      try {
        const after = await read(relative, true);
        if (before === null ? after !== null : after === null || !before.equals(after)) throw new Error('changed');
      } catch {
        issues.push({code: 'SOURCE_CHANGED', message: 'Исходные данные изменены во время проверки; повторите команду', path: relative});
      }
    }
    return issues;
  };
  return {read, verify};
}

async function readExtraction(project: Project, reader: ReturnType<typeof snapshotReader>, allowEmpty = false) {
  const source = project.config.bmad.epics;
  let raw: Buffer | null = null;
  try {
    raw = await reader.read(source);
    const extracted = extractDependencyGraph(raw!.toString('utf8'), source, {allowEmpty});
    extracted.report.source.sha256 = hash(raw!);
    return {...extracted, sourceState: {state: 'present', path: source} satisfies StatusSource};
  } catch (caught) {
    return {backlog: [] as Story[], epics: [] as Epic[], sourceState: {state: asError(caught).code === 'ENOENT' ? 'missing' : 'invalid', path: source} satisfies StatusSource, report: {schemaVersion: 1, source: {path: source, sha256: raw ? hash(raw) : null}, stories: [], issues: [problem(caught)]} satisfies DependencyExtraction};
  }
}

export async function extractDependencies(project: Project): Promise<DependencyExtraction> {
  const reader = snapshotReader(project);
  const {report} = await readExtraction(project, reader);
  report.issues.push(...await reader.verify());
  return report;
}

export async function readDependencyContext(project: Project, {allowEmptyBacklog = false} = {}) {
  const reader = snapshotReader(project);
  const {report: extraction, backlog, epics, sourceState} = await readExtraction(project, reader, allowEmptyBacklog);
  const issues: Issue[] = [];
  let registry: Registry | null = null, statuses: Record<string, string> | null = null;
  try {registry = parseRegistry((await reader.read('.mad-openspec/registry.json', true))?.toString('utf8') ?? null);} catch (caught) {issues.push(problem(caught));}
  const sprintSource: StatusSource = {state: 'present', path: project.config.bmad.sprintStatus};
  try {statuses = parseSprint((await reader.read(project.config.bmad.sprintStatus))!.toString('utf8'), project.config.bmad.sprintStatus).statuses;} catch (caught) {issues.push(problem(caught)); sprintSource.state = asError(caught).code === 'ENOENT' ? 'missing' : 'invalid';}
  const byId = new Map(extraction.stories.map(story => [story.storyId, story]));
  const completion = new Map<string, Promise<{done: boolean; status: string | null; issues: Issue[]}>>();
  const completed = (id: string) => {
    if (!completion.has(id)) completion.set(id, (async () => {
      let status: string | null = null;
      try {
        if (!registry || !statuses) throw new CliError('DEPENDENCY_STATE_UNKNOWN', `Не удалось установить завершение story ${id}`);
        const key = findStatusKey(statuses, id);
        status = statuses[key];
        if (!['backlog', 'ready-for-dev', 'in-progress', 'review', 'done'].includes(status)) throw new CliError('DEPENDENCY_STATE_UNKNOWN', `Неизвестный BMAD-статус story ${id}: ${status}`);
        const link = registry.stories[id];
        if (!link) return {done: status === 'done', status, issues: []};
        if (key !== link.statusKey || link.source !== project.config.bmad.epics) throw new CliError('CHANGE_CONFLICT', `Источник или ключ статуса story ${id} изменён`);
        if (link.phase !== 'closed') return {done: false, status, issues: []};
        if (link.storyFile) await reader.read(link.storyFile);
        await verifyReceipt(project, id, link, {checkMain: false});
        const tasks = link.receipt?.tasks;
        if (!tasks || ![tasks.total, tasks.completed, tasks.remaining].every(n => Number.isInteger(n) && n >= 0) || tasks.total < 1 || tasks.completed !== tasks.total || tasks.remaining !== 0) throw new CliError('INVALID_TASK_RECEIPT', 'Нет подтверждённых счётчиков задач в receipt');
        if ((await prepareStoryCompletion(project, link)).length) throw new CliError('INCONSISTENT_COMPLETION', `Закрытая story ${id} не согласована с BMAD`);
        return {done: true, status, issues: []};
      } catch (caught) {return {done: false, status, issues: [{code: 'DEPENDENCY_STATE_UNKNOWN', message: `Не подтверждено завершение story ${id}`, storyId: id, cause: problem(caught)}]};}
    })());
    return completion.get(id)!;
  };
  const check = async (storyId: string): Promise<DependencyCheck> => {
    const own = byId.get(storyId);
    const result: DependencyCheck = {schemaVersion: 1, storyId, dependencyState: 'ready', dependsOn: own?.dependsOn ?? null, blockedBy: [], issues: [...extraction.issues, ...issues]};
    if (!own) {
      result.dependencyState = extraction.issues.length ? (extraction.issues.some(i => i.code === 'INVALID_BACKLOG') ? 'invalid' : 'unknown') : 'invalid';
      result.issues.push({code: 'DEPENDENCY_STORY_MISSING', message: `Story ${storyId} отсутствует в доступном backlog`, storyId});
      return result;
    }
    if (result.issues.length) result.dependencyState = 'unknown';
    const paths = new Map<string, string[]>([[storyId, [storyId]]]);
    const queue = [storyId];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i], row = byId.get(id)!;
      result.issues.push(...row.issues.map(issue => ({...issue, chain: issue.chain ?? paths.get(id)})));
      if (row.extractionState === 'invalid') result.dependencyState = 'invalid';
      else if (row.extractionState === 'unknown' && result.dependencyState !== 'invalid') result.dependencyState = 'unknown';
      for (const dependency of row.dependsOn ?? []) if (!paths.has(dependency)) {
        paths.set(dependency, [...paths.get(id)!, dependency]); queue.push(dependency);
      }
    }
    // Postorder puts prerequisites before their dependants; BFS above fixes shortest chains.
    const ordered: string[] = [], visited = new Set<string>();
    const order = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dependency of byId.get(id)?.dependsOn ?? []) order(dependency);
      if (id !== storyId) ordered.push(id);
    };
    order(storyId);
    for (const id of ordered) {
      const state = await completed(id);
      result.issues.push(...state.issues.map(issue => ({...issue, chain: paths.get(id)})));
      if (state.issues.length && result.dependencyState !== 'invalid') result.dependencyState = 'unknown';
      if (!state.done) result.blockedBy.push({storyId: id, title: byId.get(id)?.title ?? null, bmadStatus: state.status, phase: registry?.stories[id]?.phase ?? null, chain: paths.get(id)!});
    }
    if (result.dependencyState === 'ready' && result.blockedBy.length) result.dependencyState = 'blocked';
    return result;
  };
  return {extraction, backlog, epics, registry, statuses, issues, sources: {backlog: sourceState, sprintStatus: sprintSource}, check, verifyUnchanged: reader.verify};
}

export function invalidateChangedCheck(result: DependencyCheck, issues: Issue[]) {
  if (!issues.length) return;
  if (result.dependencyState !== 'invalid') result.dependencyState = 'unknown';
  result.issues.push(...issues);
}

export async function checkDependencies(project: Project, storyId: string): Promise<DependencyCheck> {
  const context = await readDependencyContext(project);
  const result = await context.check(storyId);
  invalidateChangedCheck(result, await context.verifyUnchanged());
  return result;
}

export function formatExtraction(report: DependencyExtraction) {
  const lines = report.stories.map(row => `${row.storyId} ${row.title ?? ''} | ${row.extractionState} | зависимости: ${row.dependsOn === null ? '?' : row.dependsOn.join(', ') || 'нет'}`);
  for (const row of report.stories) for (const issue of row.issues) lines.push(`  ${row.storyId} ${issue.code}: ${issue.message} (${report.source.path}:${issue.line})${row.fields.length ? `\n    ${row.fields.map(field => field.value).join('\n    ')}` : ''}`);
  for (const issue of report.issues) lines.push(`${issue.code}: ${issue.message}`);
  return `${lines.join('\n')}\n`;
}

export function formatDependencyCheck(report: DependencyCheck) {
  const lines = [`Story ${report.storyId}: зависимости ${report.dependencyState}`];
  for (const blocker of report.blockedBy) lines.push(`${report.dependencyState === 'blocked' ? `Story ${report.storyId} заблокирована: сначала выполните story ${blocker.storyId}` : `Незавершённая prerequisite story ${blocker.storyId}`} — «${blocker.title ?? 'название неизвестно'}» (BMAD: ${blocker.bmadStatus ?? '?'}, фаза: ${blocker.phase ?? '—'}; ${blocker.chain.join(' -> ')})`);
  for (const issue of report.issues) lines.push(`${issue.code}: ${issue.message}${issue.path ? ` (${issue.path}:${issue.line ?? '?'})` : ''}${issue.chain ? ` (${(issue.chain as string[]).join(' -> ')})` : ''}${issue.fields ? `\n  ${JSON.stringify(issue.fields)}` : ''}`);
  return `${lines.join('\n')}\n`;
}
