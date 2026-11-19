import {asError} from './errors.ts';
import type {Project, PreparedInput, ChangeInput, ParsedRequirement} from './types.ts';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {Ajv} from 'ajv';
import {CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';
import {readBacklog, withoutFences} from './bmad.ts';

const schema = JSON.parse(await readFile(new URL('../schemas/change-input.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({allErrors: true, strict: true, strictRequired: false}).compile<ChangeInput>(schema);
function fail(message: string): never {throw new CliError('INVALID_INPUT', message);}
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function checkText(text: string, label: string, multiline = false) {
  if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\u2028\u2029]/.test(text) || (!multiline && /[\r\n]/.test(text)) || /^\s{0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|[-*+] \[[ xX]\])/m.test(text)) fail(`Недопустимая Markdown-структура в ${label}`);
}
const checkName = (text: string, label: string) => {
  checkText(text, label);
  if (text !== text.trim() || /`|\s#+$/.test(text)) fail(`Неканоническое имя ${label}`);
};

export function parseRequirements(text: string) {
  const visible = withoutFences(text);
  const requirements = new Map<string, ParsedRequirement>();
  let current: ParsedRequirement | null = null;
  for (const line of visible.split('\n')) {
    const req = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line);
    if (req) {
      const name = req[1].replace(/[ \t]+#+$/, '').trim();
      if (requirements.has(name)) fail(`Повтор requirement: ${name}`);
      current = {name, scenarios: []}; requirements.set(name, current);
    } else if (/^#{1,3}\s/.test(line)) current = null;
    const scenario = /^####\s+Scenario:\s*(.+?)\s*$/.exec(line);
    if (scenario && current) {
      const name = scenario[1].replace(/[ \t]+#+$/, '').trim();
      if (current.scenarios.includes(name)) fail(`Повтор scenario: ${name}`);
      current.scenarios.push(name);
    }
  }
  return requirements;
}

export async function validateInput(project: Project, storyId: string, value: unknown): Promise<PreparedInput> {
  if (!validateSchema(value)) fail(`JSON не соответствует schema: ${JSON.stringify(validateSchema.errors)}`);
  if (value.story.id !== storyId) fail('ID выбранной story не совпадает со входом');
  const source = await assertWritablePath(project.root, value.story.source);
  if (source !== path.resolve(project.root, project.config.bmad.epics)) fail('Источник story не совпадает с настроенным backlog');
  if (!(await readBacklog(source)).some(s => s.id === storyId)) fail(`Story ${storyId} отсутствует`);
  checkText(value.title, 'title'); checkText(value.why, 'why', true);
  for (const task of value.tasks ?? []) checkText(task, 'tasks');
  const changeDir = path.resolve(project.root, project.config.openspec.root, 'openspec/changes', `story-${storyId.replace('.', '-')}`);
  const href = (file: string) => path.relative(changeDir, file).split(path.sep).map(part => encodeURIComponent(part).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16)}`)).join('/');
  const referenceLinks = [];
  for (const ref of value.references) {
    const file = await assertWritablePath(project.root, ref.path);
    let content;
    try {if (!(await stat(file)).isFile()) throw new Error('not a file'); content = withoutFences(await readFile(file, 'utf8'));}
    catch {throw new CliError('INVALID_REFERENCE', `Ссылка не читается: ${ref.path}`, {path: ref.path});}
    if (ref.requirementId) {
      checkName(ref.requirementId, 'requirementId');
      const id = escaped(ref.requirementId);
      if (!new RegExp(`^\\s*(?:[-*]\\s+|#{1,6}\\s+)?(?:\\*\\*)?${id}(?:\\*\\*)?\\s*:|^#{1,6}\\s+Requirement:\\s*${id}(?:\\s*[:—-]|\\s*$)`, 'm').test(content)) throw new CliError('INVALID_REFERENCE', `Требование ${ref.requirementId} отсутствует: ${ref.path}`, {path: ref.path});
    }
    referenceLinks.push(href(file));
  }
  const prepared: PreparedInput = {...structuredClone(value), sourceLink: '', referenceLinks: []};
  const capabilityNames = new Set();
  for (const cap of prepared.capabilities) {
    if (capabilityNames.has(cap.path)) fail(`Повтор capability: ${cap.path}`);
    capabilityNames.add(cap.path);
    const file = await assertWritablePath(project.root, path.resolve(project.root, project.config.openspec.root, 'openspec/specs', cap.path, 'spec.md'));
    let old = new Map<string, ParsedRequirement>();
    try {old = parseRequirements(await readFile(file, 'utf8')); cap.isNew = false;}
    catch (caught) {const error = asError(caught);if (error.code !== 'ENOENT') throw error; cap.isNew = true;}
    if (cap.purpose) checkText(cap.purpose, 'purpose', true);
    if (cap.isNew && (!cap.purpose || [...cap.purpose.trim()].length < 50 || cap.requirements.some(r => r.operation !== 'ADDED'))) fail(`Новой capability ${cap.path} нужны purpose >=50 символов и только ADDED requirements`);
    const renames = new Map<string, ParsedRequirement>();
    const consumed = new Set();
    const produced = new Set();
    for (const r of cap.requirements.filter(r => r.operation === 'RENAMED')) {
      checkName(r.name, 'requirement'); checkName(r.from, 'from');
      if (!old.has(r.from) || old.has(r.name) || consumed.has(r.from) || produced.has(r.name) || r.from === r.name) fail('Конфликт RENAMED requirement');
      consumed.add(r.from); produced.add(r.name); renames.set(r.name, old.get(r.from)!);
    }
    const operations = new Set();
    for (const r of cap.requirements) {
      checkName(r.name, 'requirement');
      if (r.operation === 'RENAMED') continue;
      if (operations.has(r.name)) fail(`Конфликт операций: ${r.name}`);
      operations.add(r.name);
      if (r.operation === 'ADDED') {
        if (old.has(r.name) || produced.has(r.name)) fail(`ADDED уже существует: ${r.name}`);
      } else {
        const previous = r.operation === 'MODIFIED' ? (renames.get(r.name) ?? old.get(r.name)) : old.get(r.name);
        if (!previous || consumed.has(r.name) || (r.operation === 'REMOVED' && produced.has(r.name))) fail(`Не найдено применимое требование ${r.name}`);
        if (r.operation === 'MODIFIED' && previous.scenarios.some(name => !r.scenarios.some(s => s.name === name))) fail(`MODIFIED теряет старые сценарии: ${r.name}`);
      }
      if ('text' in r) checkText(r.text, 'text', true);
      if ('reason' in r) checkText(r.reason, 'reason', true);
      if ('migration' in r) checkText(r.migration, 'migration', true);
      const names = new Set();
      for (const scenario of ('scenarios' in r ? r.scenarios : [])) {
        checkName(scenario.name, 'scenario');
        if (names.has(scenario.name)) fail(`Повтор scenario: ${scenario.name}`);
        names.add(scenario.name);
        for (const field of ['given', 'when', 'then'] as const) if (scenario[field]) checkText(scenario[field], field);
        for (const and of scenario.and ?? []) checkText(and, 'and');
      }
    }
  }
  prepared.sourceLink = href(source);
  prepared.referenceLinks = referenceLinks;
  return prepared;
}
