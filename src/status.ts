import {asError} from './errors.ts';
import type {Project, OpenSpec, StatusReport, StatusRow, StoryLink} from './types.ts';
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {findStatusKey, prepareStoryCompletion} from './bmad.ts';
import {readDependencyContext} from './dependencies.ts';
import {problem, CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';
import {changeDirectory, verifyMarker} from './create.ts';
import {verifyReceipt} from './close.ts';
import {emptyStatus, summarizeStatus, workflowState} from './status-summary.ts';

export async function collectStatus(project: Project, openspec: OpenSpec) {
  const report: StatusReport = emptyStatus();
  const context = await readDependencyContext(project, {allowEmptyBacklog: true});
  const {backlog, registry, statuses} = context;
  report.inputs = {connection: {state: 'present', path: '.mad-openspec/config.json'}, ...context.sources};
  report.issues.push(...context.extraction.issues, ...context.issues);
  const byId = new Map(backlog.map(story => [story.id, story]));
  for (const id of Object.keys(registry?.stories ?? {})) if (!byId.has(id)) byId.set(id, {id, title: null, missing: true});
  for (const story of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}))) {
    const link = registry?.stories[story.id];
    const dependencies = await context.check(story.id);
    const row: StatusRow = {storyId: story.id, epicId: story.id.split('.')[0], workflowState: 'unknown', title: story.title, bmadStatus: null, changeId: link?.changeId ?? null, archivePath: link?.archivePath ?? null, phase: link?.phase ?? null, tasks: null, dependencyState: dependencies.dependencyState, dependsOn: dependencies.dependsOn, blockedBy: dependencies.blockedBy, issues: []};
    if (story.missing) row.issues.push({code: 'MISSING_STORY', message: 'Связанная story отсутствует в backlog'});
    if (statuses) {
      try {
        const key = findStatusKey(statuses, story.id);
        row.bmadStatus = statuses[key];
        if (!['backlog', 'ready-for-dev', 'in-progress', 'review', 'done'].includes(row.bmadStatus!)) row.issues.push({code: 'UNKNOWN_BMAD_STATUS', message: `Неизвестный BMAD-статус: ${row.bmadStatus}`});
        if (link && (key !== link.statusKey || link.source !== project.config.bmad.epics)) row.issues.push({code: 'CHANGE_CONFLICT', message: 'Источник или ключ статуса связи изменён'});
      } catch (caught) {const error = asError(caught);row.issues.push(problem(error));}
    }
    if (link) {
      try {
        if (['archived', 'closed'].includes(link.phase)) {
          await verifyReceipt(project, story.id, link, {checkMain: false});
          const tasks = link.receipt?.tasks;
          if (!tasks || !(['total', 'completed', 'remaining'] as const).every(k => Number.isInteger(tasks[k]) && tasks[k] >= 0) || tasks.total < 1 || tasks.completed !== tasks.total || tasks.remaining !== 0) throw new CliError('INVALID_TASK_RECEIPT', 'Нет подтверждённых счётчиков задач в receipt');
          row.tasks = tasks;
          if (link.phase === 'closed' && (await prepareStoryCompletion(project, link)).length) row.issues.push({code: 'INCONSISTENT_COMPLETION', message: 'Закрытый change не согласован со статусом BMAD'});
        } else {
          const directory = await assertWritablePath(project.root, changeDirectory(project, link.changeId));
          await verifyMarker(project, story.id, link, directory);
          if (link.phase === 'active') {
            await openspec.status(link.changeId);
            const tasks = await openspec.tasks(link.changeId);
            row.tasks = {total: tasks.total, completed: tasks.completed, remaining: tasks.remaining};
            if (tasks.total === 0) row.issues.push({code: 'EMPTY_TASKS', message: 'Список задач пуст'});
          }
        }
      } catch (caught) {const error = asError(caught);row.issues.push(problem(error));}
      const pending = ({
        creating: ['CREATE_INCOMPLETE', 'Создание не завершено; повторите create с исходным JSON'],
        archiving: ['RECOVERY_REQUIRED', 'Результат archive не подтверждён; требуется восстановление'],
        archived: ['BMAD_UPDATE_PENDING', 'Change архивирован; исправьте ошибку BMAD и повторите close'],
        'recovery-required': ['RECOVERY_REQUIRED', 'Результат операции требует проверки; delta повторно не применяется']
      } as Partial<Record<StoryLink['phase'], [string, string]>>)[link.phase];
      if (pending) row.issues.push({code: pending[0], message: pending[1]});
      if (link.phase === 'active' && row.bmadStatus === 'done') row.issues.push({code: 'INCONSISTENT_COMPLETION', message: 'BMAD сообщает done, но связанный change ещё открыт'});
    }
    row.workflowState = workflowState(row, registry !== null && context.sources.backlog.state === 'present');
    row.issues.push(...dependencies.issues);
    report.stories.push(row);
  }
  const changes = path.resolve(project.root, project.config.openspec.root, 'openspec/changes');
  for (const [directory, archived] of [[changes, false], [path.join(changes, 'archive'), true]] as const) {
    try {
      await assertWritablePath(project.root, directory);
      for (const entry of await readdir(directory, {withFileTypes: true})) {
        const match = (archived ? /^\d{4}-\d{2}-\d{2}-(story-\d+-\d+)$/ : /^(story-\d+-\d+)$/).exec(entry.name);
        if (!match) continue;
        const relative = path.relative(project.root, path.join(directory, entry.name));
        const found = registry && Object.values(registry.stories).some(link => archived ? link.archivePath === relative : link.changeId === match[1] && !link.archivePath);
        if (!found) {
          const issue = {code: 'UNLINKED_CHANGE', message: `Нет подтверждённой связи: ${relative}`, path: relative};
          report.issues.push(issue);
          const row = report.stories.find(s => `story-${s.storyId.replace('.', '-')}` === match[1]);
          if (row) {row.workflowState = 'attention'; row.issues.push(issue);}
        }
      }
    } catch (caught) {const error = asError(caught);if (error.code !== 'ENOENT') report.issues.push(problem(error));}
  }
  const changed = await context.verifyUnchanged();
  report.issues.push(...changed);
  if (changed.length) for (const row of report.stories) {
    row.workflowState = 'unknown';
    if (row.dependencyState !== 'invalid') row.dependencyState = 'unknown';
    row.issues.push(...changed);
  }
  for (const source of [report.inputs.backlog, report.inputs.sprintStatus]) if (changed.some(i => i.path === source.path)) source.state = 'unknown';
  return summarizeStatus(report, context.epics, statuses);
}
