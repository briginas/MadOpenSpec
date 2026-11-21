import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bmadBin} from './installers.ts';
import {CliError} from './errors.ts';

export const planningSkillIds = [
  'bmad-product-brief', 'bmad-spec', 'bmad-prd', 'bmad-architecture', 'bmad-ux',
  'bmad-brainstorming', 'bmad-create-epics-and-stories', 'bmad-sprint-planning',
  'bmad-correct-course', 'bmad-help', 'bmad-review', 'bmad-advanced-elicitation', 'bmad-party-mode',
];
const selected = new Set(planningSkillIds);
export function matchesPlanningProfile(ids: string[]) {
  const installed = new Set(ids);
  return ids.length === selected.size && planningSkillIds.every(id => installed.has(id));
}

export type CsvRow = Record<string, string>;
const parseCsv = createRequire(bmadBin())('csv-parse/sync').parse;
export async function readBmadCatalog(file: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(file, 'utf8'), {columns: true, skip_empty_lines: true});
}

function encodeCatalog(file: string, rows: CsvRow[]) {
  if (!rows.length) throw new CliError('SETUP_POSTCONDITION_FAILED', `Пустой каталог BMAD: ${file}`);
  const columns = Object.keys(rows[0]);
  const lines = rows.map(row => columns.map(key => `"${row[key].replaceAll('"', '""')}"`).join(','));
  return [columns.join(','), ...lines, ''].join('\n');
}

export async function planPlanningCatalogs(root: string) {
  const runtime = path.join(root, '_bmad');
  const skillFile = path.join(runtime, '_config/skill-manifest.csv');
  const skills = await readBmadCatalog(skillFile);
  const retained = skills.filter(skill => selected.has(skill.canonicalId));
  if (!matchesPlanningProfile(retained.map(skill => skill.canonicalId))) {
    throw new CliError('SETUP_POSTCONDITION_FAILED', 'В установщике BMAD отсутствует полный набор скилов planning');
  }
  const removed = skills.filter(skill => !selected.has(skill.canonicalId));
  const excludedRoots = removed.map(skill => path.posix.dirname(skill.path) + '/');
  const catalogs = new Map<string, string>();
  catalogs.set('_config/skill-manifest.csv', encodeCatalog(skillFile, retained));
  for (const name of ['core/module-help.csv', 'bmm/module-help.csv', '_config/bmad-help.csv']) {
    const file = path.join(runtime, name);
    const rows = (await readBmadCatalog(file)).filter(row => row.skill === '_meta' || selected.has(row.skill));
    catalogs.set(name, encodeCatalog(file, rows));
  }
  const filesManifest = path.join(runtime, '_config/files-manifest.csv');
  const files = (await readBmadCatalog(filesManifest)).filter(row =>
    !excludedRoots.some(prefix => ('_bmad/' + row.path).startsWith(prefix)));
  for (const row of files) {
    const content = catalogs.get(row.path);
    if (content !== undefined) row.hash = createHash('sha256').update(content).digest('hex');
  }
  catalogs.set('_config/files-manifest.csv', encodeCatalog(filesManifest, files));
  return {removed, catalogs};
}

export async function preparePlanningCatalogs(stage: string) {
  const {catalogs} = await planPlanningCatalogs(stage);
  for (const [name, content] of catalogs) await writeFile(path.join(stage, '_bmad', name), content);
}
