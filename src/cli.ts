import type {ParseArgsOptionsConfig} from 'node:util';
import type {BmadConfig, OpenSpec} from './types.ts';
import {asError} from './errors.ts';
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {CliError, problem} from './errors.ts';
import {loadConfig, assertWritablePath} from './project.ts';
import {connectProject} from './connect.ts';
import {makeOpenSpec} from './openspec.ts';
import {createChange} from './create.ts';
import {closeChange} from './close.ts';
import {storyProgress} from './progress.ts';
import {collectProjectStatus} from './status-project.ts';
import {formatEpicProgress, formatStatus} from './status-text.ts';
import {setupProject, formatSetup} from './setup.ts';
import {extractDependencies, checkDependencies, formatExtraction, formatDependencyCheck} from './dependencies.ts';

import {cliVersion as version} from './version.ts';
import {updateProject} from './update.ts';
const help = `mad-openspec ${version}

Команды (из корня целевого проекта):
  setup [--dry-run] [--json] [--bmad-profile <planning|full>] [--openspec-root <path>]
        [--user-name <name>] [--communication-language <language>] [--document-output-language <language>]
  update [--dry-run] [--json]
  connect [--epics <path>] [--sprint-status <path>] [--bmad-manifest <path>] [--openspec-root <path>] [--json]
  change create --story <N.M> --input <file.json> [--story-file <path>]
  change close <change-id>
  dependencies extract [--json]
  change check --story <N.M> [--json]
  change progress --story <N.M>
  status [--summary] [--json]
  status --epic <N> [--just-closed <N.M>]
  --help
  --version

BMAD v6.12.4; OpenSpec 1.16.0; локальная spec-driven schema.
Setup устанавливает инструменты. Connect подключает готовый backlog.
Status показывает сводку и открытые истории. --summary добавляет список по эпикам, --json выводит полный отчёт.
Для автопоиска по BMAD config требуется Python 3.11+; явные пути работают без Python.
`;
function invalid(message: string): never {throw new CliError('INVALID_ARGUMENTS', message);}
function stringOptions<const T extends readonly string[]>(keys: T): Record<T[number], {type: 'string'}> {
  return Object.fromEntries(keys.map(key => [key, {type: 'string'}])) as Record<T[number], {type: 'string'}>;
}
function options<T extends ParseArgsOptionsConfig>(args: string[], shape: T) {
  let parsed;
  try {parsed = parseArgs({args, options: shape, strict: true, allowPositionals: false, tokens: true});}
  catch (caught) {const error = asError(caught);invalid(error.message);}
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') invalid('Неожиданный аргумент');
    if (seen.has(token.name)) invalid(`Опция --${token.name} указана дважды`);
    seen.add(token.name);
  }
  return parsed.values;
}
function required<T extends Record<string, unknown>, K extends string>(values: T, keys: K[]): asserts values is T & Record<K, string> {
  for (const key of keys) if (typeof values[key] !== 'string' || !values[key].trim()) invalid(`Требуется --${key}`);
}

const writeStdout = (text: string) => {process.stdout.write(text);};

export async function runCli(argv: string[], {cwd = process.cwd(), stdout = writeStdout, stdoutIsTTY = stdout === writeStdout && process.stdout.isTTY === true, stderr = text => {process.stderr.write(text);}, openspec, resolveConfig}: {cwd?: string; stdout?: (text: string) => void; stdoutIsTTY?: boolean; stderr?: (text: string) => void; openspec?: OpenSpec; resolveConfig?: (root: string) => Promise<BmadConfig>} = {}) {
  let jsonStatus = false;
  const jsonExtract = argv[0] === 'dependencies' && argv[1] === 'extract' && argv.includes('--json');
  const jsonCheck = argv[0] === 'change' && argv[1] === 'check' && argv.includes('--json');
  let checkedStory: string | null = null;
  const jsonUpdate = argv[0] === 'update' && argv.includes('--json');
  let jsonSetup = argv[0] === 'setup' && argv.includes('--json');
  let jsonConnect = argv[0] === 'connect' && argv.includes('--json');
  try {
    if (argv.length === 1 && argv[0] === '--version') {stdout(`${version}\n`); return 0;}
    if (argv[0] === 'init') invalid('Команда init переименована; используйте mad-openspec connect');
    if (argv.length === 1 && argv[0] === '--help' || ['setup', 'update', 'connect', 'status', 'change', 'dependencies'].includes(argv[0]) && argv.at(-1) === '--help') {stdout(help); return 0;}
    const root = path.resolve(cwd);
    if (argv[0] === 'update') {
      const flags = options(argv.slice(1), {'dry-run': {type: 'boolean'}, json: {type: 'boolean'}});
      const report = await updateProject(root, flags['dry-run'] === true);
      if (jsonUpdate) stdout(JSON.stringify(report, null, 2) + '\n');
      else {
        const title = report.files.length === 0 ? 'Проект актуален' : report.dryRun ? 'План обновления' : 'Проект обновлён';
        stdout(`${title} (MadOpenSpec ${version})\n`);
        for (const file of report.files) stdout(`  ${file}\n`);
      }
      return 0;
    }
    if (argv[0] === 'setup') {
      const v = options(argv.slice(1), {'dry-run': {type:'boolean'}, json: {type:'boolean'}, ...stringOptions(['bmad-profile','openspec-root','user-name','communication-language','document-output-language'])});
      for (const [key,value] of Object.entries(v)) if (typeof value === 'string' && !value.trim()) invalid(`Пустая опция --${key}`);
      const profile = v['bmad-profile'];
      if (profile !== undefined && profile !== 'planning' && profile !== 'full') invalid('--bmad-profile принимает planning или full');
      const report = await setupProject(root, {bmadProfile:profile, dryRun:v['dry-run'], openspecRoot:v['openspec-root'], userName:v['user-name'], communicationLanguage:v['communication-language'], documentOutputLanguage:v['document-output-language']}, {log:stderr});
      stdout(jsonSetup ? `${JSON.stringify(report,null,2)}\n` : formatSetup(report));
      return report.issues.length ? 1 : 0;
    }
    if (argv[0] === 'connect') {
      const v = options(argv.slice(1), {json:{type:'boolean'},...stringOptions(['epics', 'sprint-status', 'bmad-manifest', 'openspec-root'])});
      const project = await connectProject(root, {epics:v.epics, sprintStatus:v['sprint-status'], manifest:v['bmad-manifest'], openspecRoot:v['openspec-root']}, {openspec});
      const report={schemaVersion:1,config:project.config,sources:project.sources,issues:[]};
      stdout(jsonConnect?`${JSON.stringify(report,null,2)}\n`:`Подключён MadOpenSpec: .mad-openspec/config.json\n${Object.entries(project.sources).map(([role,s])=>`${role}: ${s.path} (${s.origin})\n`).join('')}`);return 0;
    }
    let action: string;
    let v: Record<string, string | undefined> = {};
    if (argv[0] === 'status') {
      const flags = options(argv.slice(1), {json: {type: 'boolean'}, summary: {type: 'boolean'}, ...stringOptions(['epic', 'just-closed'])});
      const justClosed = flags['just-closed'];
      if (flags.epic !== undefined && (!/^[1-9]\d*$/.test(flags.epic) || flags.json || flags.summary)) {
        invalid('Используйте status --epic N отдельно от --json и --summary');
      }
      if (justClosed !== undefined && (!/^[1-9]\d*\.[1-9]\d*$/.test(justClosed) || justClosed.split('.')[0] !== flags.epic)) {
        invalid('--just-closed требует ID истории из выбранного --epic N');
      }
      jsonStatus = flags.json === true;
      const report = await collectProjectStatus(root, {openspec, resolveConfig});
      if (flags.epic) {
        stdout(formatEpicProgress(report, flags.epic, justClosed));
        return 0;
      }
      stdout(jsonStatus ? `${JSON.stringify(report, null, 2)}\n` : formatStatus(report, {overview: flags.summary, color: stdoutIsTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'}));
      return report.summary.stage === 'attention' ? 1 : 0;
    } else if (argv[0] === 'dependencies' && argv[1] === 'extract') {
      options(argv.slice(2), {json: {type: 'boolean'}}); action = 'extract';
    } else if (argv[0] === 'change' && ['check', 'progress'].includes(argv[1])) {
      action = argv[1];
      const values = options(argv.slice(2), action === 'check'
        ? {json: {type: 'boolean'}, ...stringOptions(['story'])}
        : stringOptions(['story']));
      required(values, ['story']);
      if (!/^[1-9]\d*\.[1-9]\d*$/.test(values.story)) invalid('Story ID должен иметь вид N.M');
      v.story = values.story; checkedStory = values.story;
    } else if (argv[0] === 'change' && argv[1] === 'create') {
      v = options(argv.slice(2), stringOptions(['story', 'input', 'story-file']));
      required(v, ['story', 'input']);
      if (!/^[1-9]\d*\.[1-9]\d*$/.test(v.story)) invalid('Story ID должен иметь вид N.M');
      action = 'create';
    } else if (argv[0] === 'change' && argv[1] === 'close') {
      if (argv.length !== 3 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(argv[2])) invalid('Требуется change close <change-id>');
      action = 'close';
    } else invalid('Неизвестная команда; используйте --help');
    const project = {root, config: await loadConfig(root)};
    if (action === 'extract') {
      const report = await extractDependencies(project);
      stdout(jsonExtract ? `${JSON.stringify(report, null, 2)}\n` : formatExtraction(report));
      return report.issues.length || report.stories.some(s => s.extractionState !== 'known') ? 1 : 0;
    }
    if (action === 'check') {
      const report = await checkDependencies(project, v.story!);
      stdout(jsonCheck ? `${JSON.stringify(report, null, 2)}\n` : formatDependencyCheck(report));
      return report.dependencyState === 'ready' ? 0 : 1;
    }
    const adapter = openspec ?? makeOpenSpec({cwd: path.resolve(root, project.config.openspec.root)});
    if (action === 'progress') {
      stdout(await storyProgress(project, v.story!, adapter));
      return 0;
    }
    if (action === 'create') {
      const file = await assertWritablePath(root, v.input!);
      let input;
      try {input = JSON.parse(await readFile(file, 'utf8'));} catch (caught) {const error = asError(caught);throw new CliError('INVALID_INPUT', `Не удалось прочитать JSON: ${error.message}`, {path: file});}
      const link = await createChange(project, {storyId: v.story!, input, storyFile: v['story-file'] ?? null}, adapter);
      stdout(`Story ${v.story}: ${link.changeId} (${link.phase})${link.archivePath ? ` → ${link.archivePath}` : ''}\n`); return 0;
    }
    const link = await closeChange(project, argv[2], adapter);
    stdout(`Закрыт ${link.changeId}: ${link.archivePath}\n`); return 0;
  } catch (caught) {const error = asError(caught);
    if (jsonUpdate) stdout(JSON.stringify({schemaVersion: 1, dryRun: argv.includes('--dry-run'), cliVersion: version, files: [], issues: [problem(error)]}, null, 2) + '\n');
    else if (jsonSetup) stdout(`${JSON.stringify({schemaVersion:1,dryRun:argv.includes('--dry-run'),steps:[],toolchain:'blocked',issues:[problem(error)],nextSteps:[]},null,2)}\n`);
    else if (jsonConnect) stdout(`${JSON.stringify({schemaVersion:1,sources:{},issues:[problem(error)]},null,2)}\n`);
    else if (jsonExtract) stdout(`${JSON.stringify({schemaVersion:1,source:{path:null,sha256:null},stories:[],issues:[problem(error)]},null,2)}\n`);
    else if (jsonCheck) stdout(`${JSON.stringify({schemaVersion:1,storyId:checkedStory,dependencyState:'unknown',dependsOn:null,blockedBy:[],issues:[problem(error)]},null,2)}\n`);
    else if (jsonStatus) stdout(`${JSON.stringify({schemaVersion: 1, stories: [], issues: [problem(error)]}, null, 2)}\n`);
    else stderr(`${error.code ?? 'IO_ERROR'}: ${error.message}\n`);
    return error.code === 'INVALID_ARGUMENTS' ? 2 : 1;
  }
}
