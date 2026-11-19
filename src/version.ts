import {readFile} from 'node:fs/promises';
import {asError, CliError} from './errors.ts';
import {assertWritablePath} from './project.ts';
import type {SetupSettings, SetupStep} from './types.ts';

export const cliVersion: string = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
export const setupStatePath = '.mad-openspec/setup-state.json';

interface SetupState {
  schemaVersion: number;
  settings: SetupSettings;
  steps: SetupStep[];
}

export async function readSetupState(root: string): Promise<SetupState | undefined> {
  const file = await assertWritablePath(root, setupStatePath);
  let text;
  try {text = await readFile(file, 'utf8');}
  catch (error) {if (asError(error).code === 'ENOENT') return; throw error;}
  try {
    const state = JSON.parse(text);
    if (state?.schemaVersion !== 1 || !state.settings || !Array.isArray(state.steps) ||
      state.steps.some((step: SetupStep) => !step || typeof step.id !== 'string')) throw new Error();
    return state;
  } catch {throw new CliError('SETUP_CONFLICT', 'Повреждён setup-state.json', {path: file});}
}

export function installedSkills(state?: SetupState) {
  return state?.steps.find(step => step.id === 'mad-openspec-skills');
}

export function checkVersion(projectVersion: string | null) {
  if (projectVersion === cliVersion) return;
  const nextStep = projectVersion && !canUpdate(projectVersion)
    ? `Запустите CLI версии ${projectVersion}.` : 'Выполните mad-openspec update.';
  throw new CliError('VERSION_MISMATCH',
    `MadOpenSpec: версия проекта ${projectVersion ?? 'не записана'}, версия CLI ${cliVersion}. ${nextStep}`,
    {projectVersion, cliVersion, nextStep});
}

// Add a source release here when its project files have an upgrade path.
export function canUpdate(version: string) {
  return ['0.3.3', '0.3.4', '0.3.5', '0.3.6', cliVersion].includes(version);
}

export async function checkSetupVersion(root: string) {
  const step = installedSkills(await readSetupState(root));
  if (step) checkVersion(step.actual ?? step.expected);
}
