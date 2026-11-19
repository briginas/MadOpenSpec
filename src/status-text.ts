import type {Issue, StatusReport, StatusRow, WorkflowState} from './types.ts';
import {requiresAttention} from './status-summary.ts';
import {CliError} from './errors.ts';

type Tone = 'blue' | 'green' | 'yellow' | 'red';
const ansi = {blue: 34, green: 32, yellow: 33, red: 31};
const states: Record<WorkflowState, {label: string; count: string; tone?: Tone}> = {
  prepared: {label: 'подготовлена', count: 'подготовлены', tone: 'blue'},
  'in-progress': {label: 'в работе', count: 'в работе', tone: 'blue'},
  'tasks-complete': {label: 'задачи выполнены, ожидает закрытия', count: 'ожидают закрытия', tone: 'blue'},
  'not-started': {label: 'не начата', count: 'не начаты'},
  done: {label: 'закрыта', count: 'закрыты', tone: 'green'},
  attention: {label: 'требует внимания', count: 'требуют внимания', tone: 'red'},
  unknown: {label: 'состояние неизвестно', count: 'состояние неизвестно', tone: 'yellow'}
};
const stages: Record<StatusReport['summary']['stage'], string> = {
  unknown: 'не определён', planning: 'планирование', 'not-connected': 'backlog не подключён',
  ready: 'выбор истории', implementation: 'есть открытые истории', complete: 'все истории закрыты', attention: 'требует внимания'
};
const sources = {present: 'есть', missing: 'отсутствует', unknown: 'не определено', ambiguous: 'несколько кандидатов', invalid: 'ошибка чтения или формата'};

export function formatEpicProgress(report: StatusReport, epicId: string, justClosed?: string) {
  if (report.inputs.backlog.state !== 'present') {
    const issue = report.issues.find(issue => issue.path === report.inputs.backlog.path) ?? report.issues[0];
    throw new CliError(issue?.code ?? 'BACKLOG_UNAVAILABLE', issue?.message ?? 'Список историй эпика недоступен');
  }
  const epic = report.epics.find(item => item.epicId === epicId);
  if (!epic) throw new CliError('EPIC_NOT_FOUND', `Эпик ${epicId} отсутствует в backlog`);
  const stories = report.stories.filter(row => row.epicId === epicId);
  if (justClosed && !stories.some(row => row.storyId === justClosed && row.phase === 'closed' && row.workflowState === 'done')) {
    throw new CliError('CLOSURE_UNCONFIRMED', `Не удалось подтвердить закрытие истории ${justClosed}`);
  }
  const lines = [`Прогресс по эпику ${epicId} — ${epic.title ?? '(название неизвестно)'} · закрыто ${epic.counts.done} из ${epic.counts.total}`, ''];
  if (!stories.length) lines.push('Историй пока нет.');
  for (const row of stories) {
    const state = row.workflowState;
    const title = `${row.storyId} ${row.title ?? '(название неизвестно)'}`;
    if (state === 'done') {
      lines.push(`✓ ${title}${row.storyId === justClosed ? ' — закрыта сейчас' : ''}`);
      continue;
    }
    const details = [];
    if (state !== 'not-started' || row.dependencyState !== 'blocked') details.push(states[state].label);
    if ((state === 'in-progress' || state === 'prepared') && row.tasks) details.push(`задачи ${row.tasks.completed}/${row.tasks.total}`);
    if (row.dependencyState === 'blocked') details.push(`ожидает ${row.blockedBy.map(story => story.storyId).join(', ')}`);
    if (row.dependencyState === 'unknown') details.push('зависимости неизвестны');
    if (row.dependencyState === 'invalid') details.push('ошибка зависимостей');
    lines.push(`${state === 'in-progress' ? '→' : '○'} ${title} — ${details.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

function storyRanges(rows: StatusRow[]) {
  const ranges: string[] = [];
  for (let start = 0; start < rows.length; start++) {
    const first = rows[start];
    let last = first;
    while (start + 1 < rows.length) {
      const next = rows[start + 1];
      if (next.epicId !== first.epicId || BigInt(next.storyId.split('.')[1]) !== BigInt(last.storyId.split('.')[1]) + 1n) break;
      last = next;
      start++;
    }
    ranges.push(first === last ? first.storyId : `${first.storyId}–${last.storyId}`);
  }
  return ranges.join(', ');
}

export function formatStatus(report: StatusReport, {overview = false, color = false} = {}) {
  const label = (value: string, tone?: Tone) => color && tone ? `\x1b[${ansi[tone]}m${value}\x1b[39m` : value;
  const {counts, activeStoryIds, stage, nextSteps} = report.summary;
  const missing = report.stories.filter(row => row.issues.some(issue => !requiresAttention(issue) && issue.storyId === row.storyId));
  const missingIds = new Set(missing.map(row => row.storyId));
  const openIds = new Set(activeStoryIds);
  const lines: string[] = [];
  const countParts = [`Эпиков: ${report.epics.length}`, `историй: ${counts.total}`];
  for (const state of Object.keys(states) as WorkflowState[]) {
    if (counts[state]) countParts.push(`${label(states[state].count, states[state].tone)}: ${counts[state]}`);
  }
  lines.push(countParts.join(' · '));
  if (overview || stage !== 'implementation') lines.push(`Этап: ${stages[stage]}`);
  if (overview || Object.values(report.inputs).some(source => source.state !== 'present')) {
    for (const [key, title] of [['connection', 'Подключение'], ['backlog', 'Backlog'], ['sprintStatus', 'Sprint status']] as const) {
      const source = report.inputs[key];
      lines.push(`${title}: ${sources[source.state]}${source.path ? ` (${source.path})` : ''}${source.candidates?.length ? ` — ${source.candidates.join(', ')}` : ''}`);
    }
    if (report.inputs.backlog.state !== 'present') lines.push('Список историй может быть неполным.');
  }

  function storyDetails(row: StatusRow) {
    const state = states[row.workflowState];
    const parts = [label(state.label, state.tone)];
    if (row.changeId) parts.push(row.changeId);
    if (row.tasks) parts.push(`задачи ${row.tasks.completed}/${row.tasks.total}`);
    else if (row.changeId) parts.push('число задач неизвестно');
    switch (row.dependencyState) {
      case 'blocked':
        parts.push(label('ожидает', 'yellow') + ' ' + row.blockedBy.map(blocker => blocker.storyId).join(', '));
        break;
      case 'unknown':
        if (!missingIds.has(row.storyId)) parts.push(label('зависимости неизвестны', 'yellow'));
        break;
      case 'invalid':
        parts.push(label('ошибка зависимостей', 'red'));
        break;
      case 'ready':
        if (openIds.has(row.storyId)) parts.push(row.dependsOn?.length ? `зависимости выполнены: ${row.dependsOn.join(', ')}` : 'прямых зависимостей нет');
    }
    return parts.join(' · ');
  }

  if (overview) {
    lines.push(`Открытые истории: ${activeStoryIds.join(', ') || 'нет по доступным данным'}`);
    const byId = new Map(report.stories.map(row => [row.storyId, row]));
    for (const epic of report.epics) {
      lines.push('', `Эпик ${epic.epicId} — ${epic.title ?? '(название неизвестно)'} · закрыто ${epic.counts.done}/${epic.counts.total}${epic.bmadStatus ? ` · BMAD: ${epic.bmadStatus}` : ''}`);
      if (!epic.storyIds.length) lines.push('  Историй пока нет.');
      for (const id of epic.storyIds) {
        const row = byId.get(id)!;
        lines.push(`  ${id}  ${row.title ?? '(название неизвестно)'} — ${storyDetails(row)}`);
      }
    }
  } else if (openIds.size) {
    lines.push('', 'Открытые истории');
    for (const row of report.stories) {
      if (openIds.has(row.storyId)) lines.push(`  ${row.storyId}  ${row.title ?? '(название неизвестно)'}`, `       ${storyDetails(row)}`);
    }
  }

  if (missing.length) {
    lines.push('', label('Зависимости не указаны', 'yellow'), `  Историй без поля Dependencies: ${missing.length} (${storyRanges(missing)}).`);
    if (report.inputs.backlog.path) lines.push(`  Уточните зависимости в ${report.inputs.backlog.path} перед реализацией.`);
  }
  const errors = new Set<string>();
  function addIssue(issue: Issue, storyId?: string) {
    if (!requiresAttention(issue)) return;
    const owner = issue.storyId ?? storyId;
    const location = issue.path ? ` (${issue.path}${issue.line ? `:${issue.line}` : ''})` : '';
    errors.add(`  ${owner ? `${owner}  ` : ''}${label(issue.code, 'red')}: ${issue.message}${location}`);
  }
  for (const issue of report.issues) addIssue(issue);
  for (const row of report.stories) for (const issue of row.issues) addIssue(issue, row.storyId);
  if (errors.size) lines.push('', label('Ошибки', 'red'), ...errors);
  if (nextSteps.length) lines.push('', ...nextSteps.map(step => `Далее: ${step}`));
  return `${lines.join('\n')}\n`;
}
