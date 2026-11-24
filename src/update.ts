import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {parseDocument} from 'yaml';
import {asError, CliError} from './errors.ts';
import {assertWritablePath, readProjectConfig} from './project.ts';
import {madSkills, sources} from './setup.ts';
import {makeOpenSpec} from './openspec.ts';
import {atomicWrite, withProjectLock} from './state.ts';
import {planPlanningRule} from './planning-rule.ts';
import {canUpdate, checkVersion, cliVersion, installedSkills, openSpecVersion, legacyOpenSpecVersion, readSetupState, setupStatePath} from './version.ts';
import {codexTargetUpdate, isLegacyOpenSkill, openSkillContent, openSkills, readManagedSkillFile, targetMarker} from './openspec-skills.ts';

// Recognized contents of earlier managed MadOpenSpec releases.
const legacySkills: Record<string, readonly string[]> = {
  'mad-openspec-guide': [
    '29f9f88e54cf1c3542367431c21d1740089714bc01f678ac012a93e27a1451b5',
    '9ea185491e139a528ba73af76ba7b892861507f0558e48ff057450d54a67baa6'
  ],
  'mad-openspec-prepare': ['0f47fd32c752a6d74d06d19ce825cfb59364c81b17dfa9a212e326c49a3310d6', 'c6b18c58e4446e5c8c2b216213fd713f374bcb1a1acd2a367112c0ec32e0c556'],
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

async function planOpenSpecUpgrade(root: string, location: string, writes: Map<string, string>) {
  const openRoot = await realpath(await assertWritablePath(root, location));
  const config = await assertWritablePath(openRoot, 'openspec/config.yaml');
  const doc = parseDocument(await readFile(config, 'utf8'));
  if (doc.errors.length || doc.has('store') || (doc.get('schema') ?? 'spec-driven') !== 'spec-driven' || doc.get('skillsScope') === 'global') {
    throw new CliError('UPDATE_CONFLICT', `Требуется локальная конфигурация OpenSpec: ${config}`, {path: config});
  }

  const openspec = makeOpenSpec({cwd: openRoot});
  await openspec.context();
  await openspec.schema();

  for (const name of openSkills) {
    const relative = path.join('.agents', 'skills', name, 'SKILL.md');
    const bytes = await readManagedSkillFile(openRoot, relative);
    const target = await openSkillContent(name);
    if (bytes?.equals(Buffer.from(target))) continue;
    const file = path.relative(root, path.join(openRoot, relative));
    if (bytes && !isLegacyOpenSkill(name, bytes)) {
      throw new CliError('UPDATE_CONFLICT', `Локальные изменения в ${file}. Сохраните их и восстановите поставляемый файл перед обновлением.`, {path: file});
    }
    writes.set(file, target);
  }
  const marker = await codexTargetUpdate(openRoot);
  if (marker !== null) writes.set(path.relative(root, path.join(openRoot, targetMarker)), marker);
}

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
    const bytes = await readManagedSkillFile(root, relative);
    const target = await readFile(path.join(sources, name, 'SKILL.md'), 'utf8');
    if (bytes) {
      if (bytes.equals(Buffer.from(target))) continue;
      if (!legacySkills[name].includes(createHash('sha256').update(bytes).digest('hex'))) {
        throw new CliError('UPDATE_CONFLICT', `Локальные изменения в ${relative}. Сохраните их и восстановите поставляемый файл перед обновлением.`, {path: relative});
      }
    }
    writes.set(relative, target);
  }
  const openStep = state?.steps.find(item => item.id === 'openspec');
  const roots = new Set<string>();
  if (config?.openspec.version === legacyOpenSpecVersion) roots.add(config.openspec.root);
  if (state && openStep) {
    if (!['completed', 'skipped'].includes(openStep.result)) {
      throw new CliError('SETUP_RECOVERY_REQUIRED', 'Сначала завершите установку OpenSpec исходной версией CLI.');
    }
    if (![openSpecVersion, legacyOpenSpecVersion].includes(openStep.actual ?? openStep.expected)) {
      throw new CliError('UNSUPPORTED_VERSION', 'Неизвестная версия установленного OpenSpec.');
    }
    roots.add(state.settings.openspecRoot ?? '.');
  }
  for (const location of roots) await planOpenSpecUpgrade(root, location, writes);

  if (state && step && (step.actual !== cliVersion || step.expected !== cliVersion ||
      (openStep && (openStep.actual !== openSpecVersion || openStep.expected !== openSpecVersion)))) {
    step.actual = step.expected = cliVersion;
    if (openStep) openStep.actual = openStep.expected = openSpecVersion;
    writes.set(setupStatePath, JSON.stringify(state, null, 2) + '\n');
  }
  if (config && (config.schemaVersion !== 2 || config.madOpenSpecVersion !== cliVersion || config.openspec.version !== openSpecVersion)) {
    config.openspec.version = openSpecVersion;
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
