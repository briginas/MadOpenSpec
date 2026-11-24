import {asError} from './errors.ts';
import type {Archive, OpenSpec, OpenSpecContext, OpenSpecSchema, OpenSpecChange, OpenSpecStatus, ProcessOptions, ProcessResult, Task} from './types.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';

const execFileAsync = promisify(execFile);
export const archiveSynced = (archive: Archive | null | undefined) => archive?.specsUpdated === true || archive?.specsUpdated === false && ['added', 'modified', 'removed', 'renamed'].every(key => archive.totals?.[key] === 0);
export function openSpecBin() {
  const entry = createRequire(import.meta.url).resolve('@fission-ai/openspec');
  return path.join(path.dirname(entry), '../bin/openspec.js');
}
export async function runProcess(file: string, args: string[], {cwd, env}: ProcessOptions): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(file, args, {cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000, shell: false});
    return {code: 0, ...result};
  } catch (caught) {const error = asError(caught);
    if (typeof error.code === 'number') return {code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? ''};
    throw new CliError('OPENSPEC_FAILED', `Не удалось запустить OpenSpec: ${error.message}`);
  }
}

export function makeOpenSpec({cwd, binPath = openSpecBin(), runProcess: run = runProcess}: {cwd: string; binPath?: string; runProcess?: typeof runProcess}): OpenSpec {
  function invalid(message: string): never {throw new CliError('INVALID_OPENSPEC_RESPONSE', message);}
  const idCheck = (id: string) => {if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new CliError('INVALID_CHANGE_ID', 'Недопустимый change ID');};
  const verifyRoot = async (value: {root?: OpenSpecContext['root']}) => {
    if (!value?.root || typeof value.root.path !== 'string') invalid('Ответ OpenSpec не содержит root');
    if (!['nearest', undefined].includes(value.root.source) || await realpath(value.root.path) !== await realpath(cwd)) throw new CliError('UNSUPPORTED_OPENSPEC_ROOT', 'Поддерживается только настроенный локальный OpenSpec-root');
  };
  const invoke = async <T>(args: string[], json = true, checkRoot = true): Promise<T> => {
    const result = await run(process.execPath, [binPath, ...args], {cwd: await realpath(cwd), env: {...process.env, OPENSPEC_TELEMETRY: '0'}});
    if (result.code !== 0) throw new CliError('OPENSPEC_FAILED', `OpenSpec завершился с ошибкой (${result.code}): ${result.stderr || result.stdout}`, {exitCode: result.code});
    if (!json) return result.stdout.trim() as T;
    let value;
    try {value = JSON.parse(result.stdout);} catch {invalid('OpenSpec вернул некорректный JSON');}
    if (checkRoot) await verifyRoot(value);
    return value as T;
  };
  return {
    version: () => invoke<string>(['--version'], false),
    schema: async () => {
      const value = await invoke<OpenSpecSchema[]>(['schemas', '--json'], true, false);
      if (!Array.isArray(value)) invalid('Неверный список schemas OpenSpec');
      const matches = value.filter(schema => schema.name === 'spec-driven');
      if (matches.length !== 1 || matches[0].source !== 'package' || !Array.isArray(matches[0].artifacts) || matches[0].artifacts.length !== 4 || !['proposal', 'specs', 'design', 'tasks'].every(id => matches[0].artifacts.includes(id))) throw new CliError('UNSUPPORTED_SCHEMA', 'Требуется встроенная spec-driven schema OpenSpec без project/user overrides');
      return matches[0];
    },
    context: async () => {
      const value = await invoke<OpenSpecContext>(['context', '--json']);
      if (!Array.isArray(value.members) || !Array.isArray(value.status) || value.status.some(x => x.severity === 'error')) invalid('Неверный OpenSpec context');
      return value;
    },
    create: async id => {
      idCheck(id);
      const directory = await assertWritablePath(await realpath(cwd), `openspec/changes/${id}`);
      const {change} = await invoke<{change: OpenSpecChange}>(['new', 'change', id, '--json']);
      if (change?.id !== id || change.schema !== 'spec-driven' || change.path !== directory || change.metadataPath !== path.join(change.path, '.openspec.yaml')) invalid('Неверный ответ создания change');
      return change;
    },
    status: async id => {
      idCheck(id);
      const value = await invoke<OpenSpecStatus>(['status', '--change', id, '--json']);
      if (value.changeName !== id || value.schemaName !== 'spec-driven' || value.changeRoot !== path.join(await realpath(cwd), 'openspec/changes', id) || !Array.isArray(value.artifacts) || !Array.isArray(value.applyRequires) || !value.artifactPaths) invalid('Неполный или неподдерживаемый OpenSpec status');
      for (const key of ['proposal', 'specs', 'design', 'tasks']) {
        const artifact = value.artifacts.find(a => a.id === key);
        if (!artifact || !['done', 'ready', 'blocked', 'skipped'].includes(artifact.status) || !Array.isArray(value.artifactPaths[key]?.existingOutputPaths)) invalid('Неверная структура артефактов OpenSpec');
        for (const file of value.artifactPaths[key].existingOutputPaths) await assertWritablePath(value.changeRoot, file);
      }
      if (value.artifacts.length !== 4 || value.applyRequires.some(key => !['proposal', 'specs', 'design', 'tasks'].includes(key))) invalid('Неизвестная schema OpenSpec');
      return value;
    },
    tasks: async id => {
      idCheck(id);
      const value = await invoke<{state: string; instruction?: string; tasks: Task[]; progress: Record<'total' | 'complete' | 'remaining', number>}>(['instructions', 'apply', '--change', id, '--json']);
      if (value.state === 'blocked') throw new CliError('OPENSPEC_BLOCKED', value.instruction ?? 'OpenSpec apply заблокирован');
      const p = value.progress;
      if (!['ready', 'all_done'].includes(value.state) || !Array.isArray(value.tasks) || !p || !(['total', 'complete', 'remaining'] as const).every(k => Number.isInteger(p[k]) && p[k] >= 0)) invalid('Неверный ответ apply');
      const tasks = value.tasks;
      for (const task of tasks) {
        if (typeof task.id !== 'string' || typeof task.description !== 'string' || typeof task.done !== 'boolean' || typeof task.sourcePath !== 'string' || !Number.isInteger(task.line) || task.line < 1) invalid('Неполная задача OpenSpec');
        await assertWritablePath(path.join(await realpath(cwd), 'openspec/changes', id), task.sourcePath);
      }
      if (p.total !== tasks.length || p.complete !== tasks.filter(t => t.done).length || p.remaining !== p.total - p.complete) invalid('Противоречивые счётчики OpenSpec');
      return {tasks, total: p.total, completed: p.complete, remaining: p.remaining};
    },
    validate: async id => {
      idCheck(id);
      const value = await invoke<{items: {id: string; type: string; valid: boolean; issues: unknown[]}[]}>(['validate', id, '--strict', '--json', '--no-interactive']);
      if (!Array.isArray(value.items) || value.items.length !== 1 || value.items[0].id !== id || value.items[0].type !== 'change' || value.items[0].valid !== true || !Array.isArray(value.items[0].issues)) invalid('OpenSpec не подтвердил строгую валидацию');
      return value.items[0];
    },
    archive: async id => {
      idCheck(id);
      const value = await invoke<{archive: Archive}>(['archive', id, '--yes', '--json']);
      const a = value.archive;
      if (a?.change !== id || typeof a.archivedAs !== 'string' || typeof a.path !== 'string' || !archiveSynced(a) || a.path !== path.join(await realpath(cwd), 'openspec/changes/archive', a.archivedAs) || !/^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*$/.test(a.archivedAs)) invalid('Неверный результат archive');
      await assertWritablePath(await realpath(cwd), a.path);
      return a;
    }
  };
}
