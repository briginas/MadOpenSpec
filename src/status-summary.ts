import type {Epic, Issue, StatusReport, StatusRow, WorkflowCounts, WorkflowState} from './types.ts';
import {compareStoryIds} from './dependencies.ts';

const missingDependenciesCode = 'DEPENDENCIES_FIELD_MISSING';
export const requiresAttention = (issue: Issue) => issue.code !== missingDependenciesCode;

export function workflowState(row: StatusRow, reliable = true): WorkflowState {
  if (row.phase && !['active', 'closed'].includes(row.phase)) return 'attention';
  if (row.issues.some(i => i.code === 'INCONSISTENT_COMPLETION')) return 'attention';
  if (!reliable || row.issues.length || row.bmadStatus === null) return 'unknown';
  if (row.phase === 'closed') return row.bmadStatus === 'done' ? 'done' : 'attention';
  if (row.phase === 'active') {
    if (row.bmadStatus === 'done') return 'attention';
    if (!row.tasks || row.tasks.total < 1) return 'unknown';
    if (row.tasks.remaining === 0) return 'tasks-complete';
    if (row.tasks.completed > 0 || ['in-progress', 'review'].includes(row.bmadStatus)) return 'in-progress';
    return 'prepared';
  }
  if (row.bmadStatus === 'done') return 'done';
  if (['in-progress', 'review'].includes(row.bmadStatus)) return 'in-progress';
  if (['backlog', 'ready-for-dev'].includes(row.bmadStatus)) return 'not-started';
  return 'unknown';
}

export function countStories(rows: StatusRow[]): WorkflowCounts {
  const counts: WorkflowCounts = {total: rows.length, 'not-started': 0, prepared: 0, 'in-progress': 0, 'tasks-complete': 0, done: 0, attention: 0, unknown: 0};
  for (const row of rows) counts[row.workflowState]++;
  return counts;
}

export function emptyStatus(): StatusReport {
  return {
    schemaVersion: 1, stories: [], issues: [], epics: [],
    inputs: {connection: {state: 'unknown', path: '.mad-openspec/config.json'}, backlog: {state: 'unknown', path: null}, sprintStatus: {state: 'unknown', path: null}},
    summary: {stage: 'unknown', counts: countStories([]), activeStoryIds: [], nextSteps: []}
  };
}

export function summarizeStatus(report: StatusReport, epics: Epic[], statuses: Record<string, string> | null) {
  report.stories.sort((a, b) => compareStoryIds(a.storyId, b.storyId));
  const byId = new Map(epics.map(e => [e.id, e]));
  // Preserve orphaned registry stories without inventing a known epic title.
  for (const row of report.stories) if (!byId.has(row.epicId)) byId.set(row.epicId, {id: row.epicId, title: null});
  report.epics = [...byId.values()].sort((a, b) => compareStoryIds(a.id, b.id)).map(epic => {
    const rows = report.stories.filter(s => s.epicId === epic.id);
    return {epicId: epic.id, title: epic.title, bmadStatus: statuses?.[`epic-${epic.id}`] ?? null, storyIds: rows.map(s => s.storyId), counts: countStories(rows)};
  });
  const counts = countStories(report.stories);
  const activeStoryIds = report.stories.filter(s => s.phase !== null && s.phase !== 'closed' || ['in-progress', 'tasks-complete'].includes(s.workflowState)).map(s => s.storyId);
  const {connection, backlog, sprintStatus} = report.inputs;
  let stage: StatusReport['summary']['stage'];
  const nextSteps: string[] = [];
  if (report.issues.some(requiresAttention) || report.stories.some(s => s.issues.some(requiresAttention))) {
    stage = 'attention';
    nextSteps.push('Устраните указанную диагностику и повторите status.');
  } else if (backlog.state === 'unknown') {
    stage = 'unknown';
    nextSteps.push('Настройте BMAD (mad-openspec setup) или подключите готовые документы через connect с явными путями.');
  } else if (backlog.state !== 'present' || !counts.total || sprintStatus.state !== 'present') {
    stage = 'planning';
    if (backlog.state !== 'present' || !counts.total) nextSteps.push('Подготовьте epics и stories: $bmad-create-epics-and-stories.');
    if (sprintStatus.state !== 'present') nextSteps.push('Подготовьте sprint status: $bmad-sprint-planning.');
  } else if (connection.state !== 'present') {
    stage = 'not-connected';
    nextSteps.push('Подключите backlog: mad-openspec connect.');
  } else if (activeStoryIds.length) {
    stage = 'implementation';
    if (counts['tasks-complete']) nextSteps.push('Для stories с выполненными tasks завершите проверки кода, затем выполните mad-openspec change close <change-id>.');
    if (counts.prepared || counts['in-progress']) nextSteps.push('Продолжите выбранную story через $mad-openspec-apply; перед реализацией требуется успешный change check.');
  } else if (counts.done === counts.total) {
    stage = report.epics.some(e => e.storyIds.length === 0) ? 'planning' : 'complete';
    if (stage === 'planning') nextSteps.push('Подготовьте stories для пустых epics: $bmad-create-epics-and-stories.');
  } else {
    stage = 'ready';
    nextSteps.push('Выберите следующую story и подготовьте change через $mad-openspec-prepare.');
  }
  report.summary = {stage, counts, activeStoryIds, nextSteps};
  return report;
}
