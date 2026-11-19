import type {BmadConfig, Epic, OpenSpec, StatusRow, Story} from './types.ts';
import path from 'node:path';
import {checkSetupVersion} from './version.ts';
import {loadConfig} from './project.ts';
import {asError, CliError, problem} from './errors.ts';
import {findBmadDocument, resolveBmadConfig} from './connect.ts';
import {findStatusKey, parseSprint} from './bmad.ts';
import {extractDependencyGraph, snapshotReader} from './dependencies.ts';
import {makeOpenSpec} from './openspec.ts';
import {collectStatus} from './status.ts';
import {emptyStatus, summarizeStatus, workflowState} from './status-summary.ts';

export async function collectProjectStatus(root: string, {openspec, resolveConfig = resolveBmadConfig}: {openspec?: OpenSpec; resolveConfig?: (root: string) => Promise<BmadConfig>} = {}) {
  const report = emptyStatus();
  try {
    const config = await loadConfig(root);
    return await collectStatus({root, config}, openspec ?? makeOpenSpec({cwd: path.resolve(root, config.openspec.root)}));
  } catch (caught) {
    if (asError(caught).code !== 'PROJECT_NOT_INITIALIZED') {
      report.inputs.connection.state = 'invalid';
      report.issues.push(problem(caught));
      return summarizeStatus(report, [], null);
    }
  }
  report.inputs.connection.state = 'missing';
  const reader = snapshotReader({root});
  let epics: Epic[] = [], stories: Story[] = [], statuses: Record<string, string> | null = null;
  let extracted: ReturnType<typeof extractDependencyGraph> | null = null;
  try {
    await checkSetupVersion(root);
    await reader.read('.mad-openspec/config.json', true);
    const registry = await reader.read('.mad-openspec/registry.json', true);
    if (registry !== null) report.issues.push({code: 'PROJECT_NOT_INITIALIZED', message: 'Реестр связей есть, но конфигурация подключения отсутствует; восстановите её перед продолжением.'});
    let hasConfig = false;
    for (const file of ['config.toml', 'config.user.toml', 'custom/config.toml', 'custom/config.user.toml']) {
      if (await reader.read(`_bmad/${file}`, true) !== null) hasConfig = true;
    }
    if (hasConfig) {
      const config = await resolveConfig(root);
      for (const [role, input, flag] of [['epics', 'backlog', '--epics'], ['sprintStatus', 'sprintStatus', '--sprint-status']] as const) {
        try {
          const source = await findBmadDocument(root, config, role);
          report.inputs[input] = source;
          if (source.state === 'ambiguous') throw new CliError('BACKLOG_AMBIGUOUS', `Несколько документов ${role}; подключите нужный через connect ${flag}: ${source.candidates!.join(', ')}`, {role, candidates: source.candidates});
          if (source.state !== 'present') continue;
          const raw = (await reader.read(source.path!))!.toString('utf8');
          if (input === 'backlog') {
            extracted = extractDependencyGraph(raw, source.path!, {allowEmpty: true});
            epics = extracted.epics; stories = extracted.backlog;
          } else statuses = parseSprint(raw, source.path!).statuses;
        } catch (caught) {
          if (report.inputs[input].state !== 'ambiguous') report.inputs[input].state = asError(caught).code === 'ENOENT' ? 'missing' : 'invalid';
          report.issues.push(problem(caught));
        }
      }
    }
  } catch (caught) {report.issues.push(problem(caught));}
  for (const story of stories) {
    const dependency = extracted?.report.stories.find(s => s.storyId === story.id);
    const row: StatusRow = {
      storyId: story.id, epicId: story.id.split('.')[0], title: story.title, workflowState: 'unknown', bmadStatus: null,
      changeId: null, archivePath: null, phase: null, tasks: null,
      dependencyState: dependency?.extractionState === 'invalid' ? 'invalid' : 'unknown', dependsOn: dependency?.dependsOn ?? null, blockedBy: [], issues: []
    };
    if (statuses) {
      try {
        row.bmadStatus = statuses[findStatusKey(statuses, story.id)];
        if (!['backlog', 'ready-for-dev', 'in-progress', 'review', 'done'].includes(row.bmadStatus!)) throw new CliError('UNKNOWN_BMAD_STATUS', `Неизвестный BMAD-статус: ${row.bmadStatus}`);
      } catch (caught) {row.issues.push(problem(caught));}
    }
    row.workflowState = workflowState(row, !report.issues.some(i => i.code === 'PROJECT_NOT_INITIALIZED'));
    row.issues.push(...dependency?.issues ?? []);
    report.stories.push(row);
  }
  const changed = await reader.verify();
  report.issues.push(...changed);
  if (changed.length) {
    for (const row of report.stories) {row.workflowState = 'unknown'; row.dependencyState = 'unknown';}
    for (const source of Object.values(report.inputs)) if (changed.some(i => i.path === source.path)) source.state = 'unknown';
  }
  return summarizeStatus(report, epics, statuses);
}
