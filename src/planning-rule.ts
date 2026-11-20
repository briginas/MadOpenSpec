import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {parseTOML, getStaticTOMLValue, type AST} from 'toml-eslint-parser';
import {asError, CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';

const planningSkills = ['bmad-spec', 'bmad-prd', 'bmad-correct-course', 'bmad-create-epics-and-stories'];
const ruleFile = '.mad-openspec/bmad-planning.md';
const reference = `file:{project-root}/${ruleFile}`;
const fact = JSON.stringify(reference);

async function readOptional(root: string, relative: string) {
  const file = await assertWritablePath(root, relative);
  // Internal aliases could redirect a team edit into a personal customization.
  let current = root;
  try {
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) {
        throw new CliError('UNSAFE_PATH', `Символическая ссылка в пути: ${current}`, {path: current});
      }
    }
    return await readFile(file, 'utf8');
  } catch (error) {
    if (asError(error).code === 'ENOENT') return undefined;
    throw error;
  }
}

function factsIn(text: string) {
  const {workflow} = parseToml(text, {integersAsBigInt: 'asNeeded'});
  if (workflow === undefined) return [];
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || workflow instanceof Date) {
    throw new Error('workflow должна быть таблицей TOML');
  }
  const facts = workflow.persistent_facts;
  if (facts === undefined) return [];
  if (!Array.isArray(facts) || !facts.every(entry => typeof entry === 'string')) {
    throw new Error('workflow.persistent_facts должен быть массивом строк');
  }
  return facts;
}

// Use source ranges so that comments, dates, numeric literals and personal formatting survive.
function insertReference(text: string) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const field = `persistent_facts = [${fact}]`;
  if (!text.trim()) return `${text}[workflow]${newline}${field}${newline}`;
  const entries = parseTOML(text, {tomlVersion: '1.0'}).body[0].body;
  const table = entries.find((node): node is AST.TOMLTable =>
    node.type === 'TOMLTable' && node.resolvedKey.length === 1 && node.resolvedKey[0] === 'workflow');
  const keys = entries.filter((node): node is AST.TOMLKeyValue => node.type === 'TOMLKeyValue');
  const find = (pairs: AST.TOMLKeyValue[], ...wanted: string[]) => pairs.find(pair => {
    const parts = getStaticTOMLValue(pair.key);
    return parts.length === wanted.length && parts.every((part, i) => part === wanted[i]);
  })?.value;
  const inline = find(keys, 'workflow');
  const facts = table ? find(table.body, 'persistent_facts') : inline?.type === 'TOMLInlineTable'
    ? find(inline.body, 'persistent_facts') : find(keys, 'workflow', 'persistent_facts');
  const insert = (offset: number, addition: string) => text.slice(0, offset) + addition + text.slice(offset);
  if (facts?.type === 'TOMLArray') {
    const first = facts.elements[0];
    return insert(first?.range[0] ?? facts.range[0] + 1, first ? fact + ', ' : fact);
  }
  if (inline?.type === 'TOMLInlineTable') {
    const first = inline.body[0];
    return insert(first?.range[0] ?? inline.range[0] + 1, first ? field + ', ' : field);
  }
  if (table) {
    const end = text.indexOf('\n', table.key.range[1]);
    return end < 0 ? text + newline + field + newline : insert(end + 1, field + newline);
  }
  return `workflow.${field}${newline}${text}`;
}

export async function planPlanningRule(root: string, conflictCode: 'SETUP_CONFLICT' | 'UPDATE_CONFLICT') {
  const writes = new Map<string, string>();
  const rule = await readFile(new URL('../assets/bmad-planning.md', import.meta.url), 'utf8');
  const existing = await readOptional(root, ruleFile);
  if (existing === undefined) writes.set(ruleFile, rule);
  else if (existing !== rule) throw new CliError(conflictCode, `Локальные изменения в ${ruleFile}`, {path: ruleFile});

  for (const skill of planningSkills) {
    const base = `_bmad/custom/${skill}`;
    const teamFile = base + '.toml';
    let team = '';
    let count = 0;
    for (const file of [teamFile, base + '.user.toml']) {
      const text = await readOptional(root, file) ?? '';
      if (file === teamFile) team = text;
      try {
        count += factsIn(text).filter(entry => entry === reference).length;
      } catch (error) {
        throw new CliError(conflictCode, `Неверная настройка BMAD в ${file}: ${asError(error).message}`, {path: file});
      }
    }
    if (count > 1) throw new CliError(conflictCode, `Правило подключено несколько раз для ${skill}`, {path: teamFile});
    if (count === 0) {
      try {
        writes.set(teamFile, insertReference(team));
      } catch (error) {
        throw new CliError(conflictCode, `Не удалось добавить правило в ${teamFile}: ${asError(error).message}`, {path: teamFile});
      }
    }
  }
  return writes;
}
