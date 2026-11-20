import path from 'node:path';
import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {asError, CliError} from './errors.ts';
import {assertWritablePath, readProjectConfig} from './project.ts';
import {exists, madSkills, sources} from './setup.ts';
import {atomicWrite, withProjectLock} from './state.ts';
import {planPlanningRule} from './planning-rule.ts';
import {canUpdate, checkVersion, cliVersion, installedSkills, readSetupState, setupStatePath} from './version.ts';

// Accepted earlier contents of each managed skill, through release 0.3.8.
const legacySkills: Record<string, readonly string[]> = {
  'mad-openspec-guide': [
    '29f9f88e54cf1c3542367431c21d1740089714bc01f678ac012a93e27a1451b5',
    '9ea185491e139a528ba73af76ba7b892861507f0558e48ff057450d54a67baa6'
  ],
  'mad-openspec-prepare': ['0f47fd32c752a6d74d06d19ce825cfb59364c81b17dfa9a212e326c49a3310d6'],
  'mad-openspec-apply': [
    'f3033a8c3d3f1a8e9de92f734745a7cc8c8de10d8b263bd3baf84167dc25b268',
    '6826fc29e7da084c117a4f2efde8c38af01e314f93d8a0a63336d5ceef483eaa',
    '4a013237b6400746b90f79dba07033b568a3044a1a8b5ba8a82998819caec256',
    '62d0e0177b80f4ff3d63dfd72e82583031d13a7fbc274c2e1da4dc3c0a3172f2'
  ],
  'mad-openspec-close': [
    '4e3cc0690bd2cc4329681a0d7ee8700d39327179987baac0da5db4d4d7a17fa8',
    'e58f9b85c02c2d453c777fcc8fc10bbdef57358fe4e8898c9aad699f8d5dc945',
    '5c20bec1deef7f8db141d7b51b04166f4cb31d2d5839f385eb79322b26f45df3'
  ]
};

async function planUpdate(root: string) {
  const configPath = '.mad-openspec/config.json';
  let config;
  try {config = await readProjectConfig(root);}
  catch (error) {if (asError(error).code !== 'PROJECT_NOT_INITIALIZED') throw error;}
  const state = await readSetupState(root);
  if (!config && !state) throw new CliError('PROJECT_NOT_INITIALIZED', 'Сначала выполните mad-openspec setup или connect.');
  const step = installedSkills(state);
  if (state && (!step || !['completed', 'skipped'].includes(step.result))) {
    throw new CliError('SETUP_RECOVERY_REQUIRED', 'Сначала завершите прерванный setup с версией CLI исходной установки.');
  }
  const installed = step?.actual ?? step?.expected;
  for (const version of [config?.madOpenSpecVersion, installed]) {
    if (version !== undefined && !canUpdate(version)) checkVersion(version);
  }

  const writes = await planPlanningRule(root, 'UPDATE_CONFLICT');
  for (const name of madSkills) {
    const relative = path.join('.agents', 'skills', name, 'SKILL.md');
    const file = await assertWritablePath(root, relative);
    // Even an internal alias could overwrite another project's managed file.
    for (const directory of ['.agents', '.agents/skills', path.dirname(relative), relative]) {
      const part = path.join(root, directory);
      if (await exists(part) && (await lstat(part)).isSymbolicLink()) {
        throw new CliError('UNSAFE_PATH', `Символическая ссылка в пути skill: ${directory}`, {path: directory});
      }
    }
    const target = await readFile(path.join(sources, name, 'SKILL.md'), 'utf8');
    if (await exists(file)) {
      const bytes = await readFile(file);
      if (bytes.equals(Buffer.from(target))) continue;
      if (!legacySkills[name].includes(createHash('sha256').update(bytes).digest('hex'))) {
        throw new CliError('UPDATE_CONFLICT', `Локальные изменения в ${relative}. Сохраните их и восстановите поставляемый файл перед обновлением.`, {path: relative});
      }
    }
    writes.set(relative, target);
  }
  if (state && step && (step.actual !== cliVersion || step.expected !== cliVersion)) {
    step.actual = step.expected = cliVersion;
    writes.set(setupStatePath, JSON.stringify(state, null, 2) + '\n');
  }
  if (config && (config.schemaVersion !== 2 || config.madOpenSpecVersion !== cliVersion)) {
    writes.set(configPath, JSON.stringify({...config, schemaVersion: 2, madOpenSpecVersion: cliVersion}, null, 2) + '\n');
  }
  return {previousVersion: config?.madOpenSpecVersion ?? installed ?? null, writes};
}

export async function updateProject(root: string, dryRun: boolean) {
  root = await realpath(root);
  const plan = await planUpdate(root);
  const report = (result: typeof plan) => ({
    schemaVersion: 1, dryRun, previousVersion: result.previousVersion, cliVersion,
    files: [...result.writes.keys()], issues: []
  });
  if (dryRun || plan.writes.size === 0) return report(plan);
  return withProjectLock(root, async () => {
    const checked = await planUpdate(root);
    for (const [file, text] of checked.writes) await atomicWrite(root, file, text);
    return report(checked);
  });
}
