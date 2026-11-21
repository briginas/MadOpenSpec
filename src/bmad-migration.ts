import {lstat, mkdir, readFile, readdir, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {planPlanningCatalogs, type CsvRow} from './bmad-profile.ts';
import {asError, CliError} from './errors.ts';
import {bmadBin} from './installers.ts';
import {assertWritablePath} from './project.ts';
import {atomicWrite} from './state.ts';

export const migrationBackup = '.mad-openspec/bmad-profile-migration';
type Migration = Awaited<ReturnType<typeof planPlanningCatalogs>>;

async function checkInstalledTree(installed: string, source: string, display: string): Promise<void> {
  const local = await lstat(installed);
  const upstream = await lstat(source).catch(error => {
    if (asError(error).code === 'ENOENT') return undefined;
    throw error;
  });
  if (local.isDirectory() && upstream?.isDirectory()) {
    for (const name of await readdir(installed)) {
      await checkInstalledTree(path.join(installed, name), path.join(source, name), path.join(display, name));
    }
  } else if (!local.isFile() || !upstream?.isFile() || !(await readFile(installed)).equals(await readFile(source))) {
    throw new CliError('SETUP_CONFLICT', `Локальные изменения в удаляемом скиле BMAD: ${display}`, {path: display});
  }
}

async function verifyRemovableSkill(base: string, row: CsvRow) {
  const id = row.canonicalId;
  const parts = row.path.split('/');
  if (!/^bmad-[a-z0-9-]+$/.test(id) || row.name !== id || parts[0] !== '_bmad' ||
      !['core', 'bmm'].includes(row.module) || parts[1] !== row.module ||
      parts.at(-2) !== id || parts.at(-1) !== 'SKILL.md' ||
      !parts.slice(2, -1).every(part => /^[a-z0-9-]+$/.test(part))) {
    throw new CliError('SETUP_CONFLICT', `Не удалось подтвердить принадлежность скила BMAD: ${id}`);
  }
  const source = path.resolve(path.dirname(bmadBin()), '../../src', row.module + '-skills', ...parts.slice(2, -1));
  const relative = path.join('.agents', 'skills', id);
  await checkInstalledTree(path.join(base, relative), source, relative);
}

export async function planBmadMigration(root: string) {
  const plan = await planPlanningCatalogs(root);
  for (const skill of plan.removed) await verifyRemovableSkill(root, skill);
  return plan;
}

// Keep originals on the same filesystem until the verified receipt has been written.
export async function migrateBmad(root: string, migration: Migration, commit: () => Promise<void>) {
  const backup = await assertWritablePath(root, migrationBackup);
  await mkdir(backup);
  const moved: string[] = [];
  async function save(relative: string) {
    const original = await assertWritablePath(root, relative);
    const saved = path.join(backup, relative);
    await mkdir(path.dirname(saved), {recursive: true});
    await rename(original, saved);
    moved.push(relative);
  }
  try {
    for (const skill of migration.removed) {
      await save(path.join('.agents', 'skills', skill.canonicalId));
      await verifyRemovableSkill(backup, skill);
    }
    for (const [name, content] of migration.catalogs) {
      const relative = path.join('_bmad', name);
      await save(relative);
      await atomicWrite(root, relative, content);
    }
    await commit();
  } catch (error) {
    for (const relative of moved.reverse()) {
      await rename(path.join(backup, relative), await assertWritablePath(root, relative));
    }
    await rm(backup, {recursive: true});
    throw error;
  }
  await rm(backup, {recursive: true});
}
