import {asError} from '../src/errors.ts';
import type {SetupReport} from '../src/types.ts';
import type {TestContext} from 'node:test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, readdir, access, mkdir, symlink, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parse} from 'yaml';
import {makeProjectFixture, snapshot} from './helpers/project.ts';
import {openSpecBin} from '../src/openspec.ts';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/mad-openspec.ts', import.meta.url));
async function run(root: string, bin: string, args: string[]) {
  try {return {code: 0, ...await exec(process.execPath, [bin, ...args], {cwd: root, encoding: 'utf8', env: {...process.env, OPENSPEC_TELEMETRY: '0'}, timeout: 30000})};}
  catch (caught) {
    const error = asError(caught);
    if (typeof error.code !== 'number') throw error;
    return {code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? ''};
  }
}
async function success(root: string, bin: string, args: string[]) {
  const result = await run(root, bin, args);
  assert.equal(result.code, 0, `${JSON.stringify(args)}\n${result.stderr}\n${result.stdout}`);
  return result;
}
async function prepared(t: TestContext, {rootAlias = false, cliBin = cli, dependencyExample = false} = {}) {
  const f = await makeProjectFixture(t, {prefix: 'Mad проект ; $(literal)-', openspec: false});
  const original = {prd: await readFile(path.join(f.root, 'planning/prd.md'), 'utf8'), epics: await readFile(path.join(f.root, f.paths.epics), 'utf8'), sprint: await readFile(path.join(f.root, f.paths.sprintStatus), 'utf8')};
  await success(f.root, openSpecBin(), ['init', '--tools', 'none', '--language', 'ru', '--no-animation']);
  if (rootAlias) await symlink('.', path.join(f.root, 'root-alias'));
  await success(f.root, cliBin, ['connect', '--epics', f.paths.epics, '--sprint-status', f.paths.sprintStatus, '--bmad-manifest', f.paths.manifest, '--openspec-root', rootAlias ? 'root-alias' : '.']);
  if (dependencyExample) await writeFile(path.join(f.root, f.paths.epics), await readFile(new URL('../docs/examples/story-dependencies/epics.md', import.meta.url)));
  await writeFile(path.join(f.root, 'input.json'), await readFile(new URL('./fixtures/change-input.json', import.meta.url)));
  await success(f.root, cliBin, ['change', 'create', '--story', '1.2', '--input', 'input.json']);
  const changeDir = path.join(f.root, 'openspec/changes/story-1-2');
  await writeFile(path.join(changeDir, 'design.md'), '# Design\n\n## Context\n\nТестовый проект для проверки файлового workflow.\n\n## Decisions\n\nСквозной тест имитирует доработку артефактов агентом; реализация приложения находится за пределами этой fixture.\n');
  return {...f, changeDir, original};
}
async function finishTasks(f: {changeDir: string}) {
  const file = path.join(f.changeDir, 'tasks.md');
  await writeFile(file, (await readFile(file, 'utf8')).replaceAll('- [ ]', '- [x]'));
}

test('connect-create-refine-close-status', async t => {
  const f = await prepared(t);
  const preparedReport = JSON.parse((await success(f.root, cli, ['status', '--json'])).stdout);
  assert.equal(preparedReport.stories[1].workflowState, 'prepared');
  await finishTasks(f);
  const beforeStatus = await snapshot(f.root);
  const pending = JSON.parse((await success(f.root, cli, ['status', '--summary', '--json'])).stdout);
  assert.equal(pending.stories[1].workflowState, 'tasks-complete');
  assert.equal(pending.summary.counts.done, 0);
  assert.deepEqual(pending.summary.activeStoryIds, ['1.2']);
  const summary = await success(f.root, cli, ['status', '--summary']);
  assert.match(summary.stdout, /Эпик 1 — Команда/);
  assert.match(summary.stdout, /задачи выполнены, ожидает закрытия/);
  assert.deepEqual(await snapshot(f.root), beforeStatus);
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  const registry = JSON.parse(await readFile(path.join(f.root, '.mad-openspec/registry.json'), 'utf8'));
  const link = registry.stories['1.2'];
  assert.equal(link.phase, 'closed');
  const main = await readFile(path.join(f.root, 'openspec/specs/invitations/spec.md'), 'utf8');
  assert.match(main, /### Requirement: Приглашение участника/);
  assert.match(main, /приглашение видно в списке/);
  assert.doesNotMatch(main, /^## ADDED Requirements/m);
  await assert.rejects(access(f.changeDir));
  const marker = JSON.parse(await readFile(path.join(f.root, link.archivePath, '.mad-openspec-link.json'), 'utf8'));
  assert.equal(marker.storyId, '1.2');
  const sprint = parse(await readFile(path.join(f.root, f.paths.sprintStatus), 'utf8'));
  assert.equal(sprint.development_status['1-2-invite-member'], 'done');
  assert.equal(sprint.development_status['1-1-create-team'], 'backlog');
  assert.equal(sprint.development_status['epic-1'], 'in-progress');
  assert.equal(await readFile(path.join(f.root, 'planning/prd.md'), 'utf8'), f.original.prd);
  assert.equal(await readFile(path.join(f.root, f.paths.epics), 'utf8'), f.original.epics);
  const report = JSON.parse((await success(f.root, cli, ['status', '--json'])).stdout);
  assert.equal(report.stories[1].archivePath, link.archivePath);
  const epic = await success(f.root, cli, ['status', '--epic', '1', '--just-closed', '1.2']);
  assert.match(epic.stdout, /закрыто 1 из 2\n\n○ 1\.1 Создать команду — не начата\n✓ 1\.2 Пригласить участника — закрыта сейчас\n$/);
  assert.equal(report.stories[1].phase, 'closed');
  assert.equal(report.stories[1].workflowState, 'done');
  assert.equal(report.summary.counts.done, 1);
  assert.deepEqual(report.issues, []);
});
test('repeat-create-after-agent-refinement', async t => {
  const f = await prepared(t);
  await writeFile(path.join(f.changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Уточнённая агентом задача\n');
  const before = await snapshot(f.root);
  await success(f.root, cli, ['change', 'create', '--story', '1.2', '--input', 'input.json']);
  assert.deepEqual(await snapshot(f.root), before);
  assert.deepEqual((await readdir(path.join(f.root, 'openspec/changes'))).filter(name => name !== 'archive'), ['story-1-2']);
});
test('close-refuses-one-unfinished-task', async t => {
  const f = await prepared(t);
  await finishTasks(f);
  const file = path.join(f.changeDir, 'tasks.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('- [x]', '- [ ]'));
  const result = await run(f.root, cli, ['change', 'close', 'story-1-2']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /INCOMPLETE_TASKS/);
  await access(f.changeDir);
  const registry = JSON.parse(await readFile(path.join(f.root, '.mad-openspec/registry.json'), 'utf8'));
  assert.equal(registry.stories['1.2'].phase, 'active');
  assert.equal(await readFile(path.join(f.root, f.paths.sprintStatus), 'utf8'), f.original.sprint);
});
test('repeat-close-is-a-bytewise-no-op', async t => {
  const f = await prepared(t);
  await finishTasks(f);
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  const before = await snapshot(f.root);
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  assert.deepEqual(await snapshot(f.root), before);
});

test('root-alias-supports-create-close-and-status', async t => {
  const f = await prepared(t, {rootAlias: true});
  await finishTasks(f);
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  const report = JSON.parse((await success(f.root, cli, ['status', '--json'])).stdout);
  assert.equal(report.stories[1].phase, 'closed');
  assert.equal(report.stories[1].bmadStatus, 'done');
});

test('already-synced-delta-closes-without-rewriting-specs', async t => {
  const f = await prepared(t);
  await finishTasks(f);
  const main = path.join(f.root, 'openspec/specs/invitations/spec.md');
  await mkdir(path.dirname(main), {recursive: true});
  const delta = await readFile(path.join(f.changeDir, 'specs/invitations/spec.md'), 'utf8');
  await writeFile(main, delta.replace('# Spec Delta', '# Invitations').replace('## ADDED Requirements', '## Requirements'));
  const before = await readFile(main, 'utf8');
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  const registry = JSON.parse(await readFile(path.join(f.root, '.mad-openspec/registry.json'), 'utf8'));
  const link = registry.stories['1.2'];
  assert.equal(link.phase, 'closed');
  assert.equal(link.receipt.archive.specsUpdated, false);
  assert.deepEqual(link.receipt.archive.totals, {added: 0, modified: 0, removed: 0, renamed: 0});
  assert.equal(await readFile(main, 'utf8'), before);
  await success(f.root, cli, ['status', '--json']);
  const closed = await snapshot(f.root);
  await success(f.root, cli, ['change', 'close', 'story-1-2']);
  assert.deepEqual(await snapshot(f.root), closed);
});

test('close-rejects-main-spec-link-to-bmad-content', async t => {
  const f = await prepared(t);
  await finishTasks(f);
  const prd = path.join(f.root, 'planning/prd.md');
  await writeFile(prd, '# Invitations\n\n## Purpose\n\nThis capability documents the existing invitation behavior for members of a team.\n\n## Requirements\n\n### Requirement: Existing\nThe system SHALL keep existing behavior.\n\n#### Scenario: Existing\n- **WHEN** existing behavior runs\n- **THEN** it works\n');
  await mkdir(path.join(f.root, 'openspec/specs/invitations'), {recursive: true});
  await symlink('../../../planning/prd.md', path.join(f.root, 'openspec/specs/invitations/spec.md'));
  const before = await snapshot(f.root);
  const result = await run(f.root, cli, ['change', 'close', 'story-1-2']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /UNSAFE_PATH/);
  assert.deepEqual(await snapshot(f.root), before);
});

test('connect-rejects-custom-spec-driven-before-writing', async t => {
  const f = await makeProjectFixture(t);
  const override = path.join(f.root, 'openspec/schemas/spec-driven/schema.yaml');
  await mkdir(path.dirname(override), {recursive: true});
  await copyFile(path.join(path.dirname(openSpecBin()), '../schemas/spec-driven/schema.yaml'), override);
  await writeFile(override, (await readFile(override, 'utf8')).replace('name: spec-driven', 'name: spec-driven\n# A project override is not the pinned package contract.'));
  const before = await snapshot(f.root);
  const result = await run(f.root, cli, ['connect', '--epics', f.paths.epics, '--sprint-status', f.paths.sprintStatus, '--bmad-manifest', f.paths.manifest, '--openspec-root', '.']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /UNSUPPORTED_SCHEMA/);
  assert.deepEqual(await snapshot(f.root), before);
});

test('setup installs real BMAD/OpenSpec without backlog then explicit connect connects it',async t=>{
  const {mkdtemp,realpath,rm,stat}=await import('node:fs/promises');const os=await import('node:os');
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'Mad setup smoke пробел ')));t.after(()=>rm(root,{recursive:true,force:true}));
  const dry=JSON.parse((await success(root,cli,['setup','--dry-run','--json'])).stdout);assert.equal(dry.toolchain,'planned');assert.deepEqual(await readdir(root),[]);
  const legacyInstructions='User instructions\n<!-- OPENSPEC:START -->\nlegacy instructions\n<!-- OPENSPEC:END -->\n';await writeFile(path.join(root,'AGENTS.md'),legacyInstructions);
  const installed=JSON.parse((await success(root,cli,['setup','--json'])).stdout);assert.equal(await readFile(path.join(root,'AGENTS.md'),'utf8'),legacyInstructions);assert.equal(installed.toolchain,'ready');assert.deepEqual(installed.issues,[]);
  const configFile = path.join(root, 'openspec/config.yaml');
  const config = parse(await readFile(configFile, 'utf8'));
  assert.match(config.context, /^All artifacts must be written in en\.$/m);
  // A project's existing language preference survives subsequent setup runs.
  const existingConfig = 'schema: spec-driven\ncontext: Write artifacts in German.\n';
  await writeFile(configFile, existingConfig);
  await assert.rejects(access(path.join(root,'.mad-openspec/config.json')));
  const before=await snapshot(root),mtime=(await stat(path.join(root,'.mad-openspec/setup-state.json'))).mtimeMs;
  const again: SetupReport=JSON.parse((await success(root,cli,['setup','--json'])).stdout);assert.ok(again.steps.every(s=>s.action==='skip'));assert.deepEqual(await snapshot(root),before);assert.equal((await stat(path.join(root,'.mad-openspec/setup-state.json'))).mtimeMs,mtime);
  // Missing OpenSpec integration is repaired without rerunning BMAD or rewriting existing files.
  await rm(path.join(root,'.agents/skills/openspec-explore'),{recursive:true});
  const mixed=JSON.parse((await success(root,cli,['setup','--json'])).stdout);assert.equal(mixed.steps[0].action,'skip');assert.equal(mixed.steps[1].action,'configure');
  assert.equal(await readFile(configFile, 'utf8'), existingConfig);
  const fixture=await makeProjectFixture(t);await mkdir(path.join(root,'planning'),{recursive:true});
  for(const f of ['epics.md','sprint-status.yaml','prd.md'])await copyFile(path.join(fixture.root,'planning',f),path.join(root,'planning',f));
  await success(root,cli,['connect','--epics','planning/epics.md','--sprint-status','planning/sprint-status.yaml','--bmad-manifest','_bmad/_config/manifest.yaml','--openspec-root','.']);
  const status=JSON.parse((await success(root,cli,['status','--json'])).stdout);assert.deepEqual(status.issues,[]);assert.equal(status.stories.length,2);
});

test('connect auto-discovery uses BMAD overrides without setup and preserves saved paths',async t=>{
  const {createRequire}=await import('node:module');const {rename}=await import('node:fs/promises');
  const f=await makeProjectFixture(t,{prefix:'Mad auto connect пробел ',openspec:false});
  await success(f.root,openSpecBin(),['init','--tools','none','--language','ru','--no-animation']);
  const scripts=path.join(path.dirname(createRequire(import.meta.url).resolve('bmad-method')),'../../src/scripts');await mkdir(path.join(f.root,'_bmad/scripts'),{recursive:true});
  for(const file of ['resolve_config.py','config_utils.py'])await copyFile(path.join(scripts,file),path.join(f.root,'_bmad/scripts',file));
  await mkdir(path.join(f.root,'_bmad/custom'),{recursive:true});
  await writeFile(path.join(f.root,'_bmad/config.toml'),'[core]\noutput_folder = "_bmad-output"\n[modules.bmm]\nplanning_artifacts = "wrong"\nimplementation_artifacts = "wrong"\n');
  await rename(path.join(f.root,'planning'),path.join(f.root,'Документы backlog'));
  await writeFile(path.join(f.root,'_bmad/custom/config.toml'),'[modules.bmm]\nplanning_artifacts = "{project-root}/Документы backlog"\nimplementation_artifacts = "{project-root}/Документы backlog"\n');
  const beforeStatus=await snapshot(f.root);
  const discovered=JSON.parse((await success(f.root,cli,['status','--summary','--json'])).stdout);
  assert.equal(discovered.inputs.backlog.path,'Документы backlog/epics.md');
  assert.equal(discovered.inputs.connection.state,'missing');assert.equal(discovered.summary.stage,'not-connected');
  assert.equal(discovered.stories.length,2);assert.deepEqual(await snapshot(f.root),beforeStatus);
  const r=JSON.parse((await success(f.root,cli,['connect','--json'])).stdout);assert.equal(r.sources.epics.origin,'bmad-config');assert.equal(r.config.bmad.epics,'Документы backlog/epics.md');
  const before=await snapshot(f.root);await success(f.root,cli,['connect']);assert.deepEqual(await snapshot(f.root),before);
  await writeFile(path.join(f.root,'_bmad/custom/config.toml'),'invalid');await success(f.root,cli,['connect']);assert.equal(JSON.parse((await success(f.root,cli,['status','--json'])).stdout).stories.length,2);
});

test('real setup skips BMAD after a failed OpenSpec step and keeps global config isolated',async t=>{
  const {mkdtemp,realpath,rm}=await import('node:fs/promises');const os=await import('node:os');const {setupProject}=await import('../src/setup.ts');const {makeInstallers}=await import('../src/installers.ts');
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'Mad partial setup ')));t.after(()=>rm(root,{recursive:true,force:true}));
  const actual=makeInstallers();const first=await setupProject(root,{}, {installers:{...actual,openspec:async()=>{throw new Error('forced OpenSpec failure');}}});assert.equal(first.toolchain,'failed');assert.equal(first.steps[0].result,'completed');
  const retry=await setupProject(root,{}, {installers:{...actual,bmad:async()=>{throw new Error('must skip already installed BMAD');}}});assert.equal(retry.toolchain,'ready');assert.equal(retry.steps[0].action,'skip');
});

test('packed CLI runs inside node_modules and includes runtime assets', async t => {
  const {root} = await makeProjectFixture(t, {prefix: 'Mad npm пакет '});
  const checkout = fileURLToPath(new URL('../', import.meta.url));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = await exec(npm, ['pack', '--json', '--pack-destination', root], {
    cwd: checkout, encoding: 'utf8', timeout: 30000,
    env: {...process.env, npm_config_cache: path.join(root, 'npm-cache')}
  });
  const [manifest]: {filename: string; files: {path: string}[]}[] = JSON.parse(packed.stdout);
  assert.ok(manifest.files.some(file => file.path === 'dist/bin/mad-openspec.js'));
  assert.equal(manifest.files.some(file => /\.(?:ts|mjs)$/.test(file.path)), false);
  const installed = path.join(root, 'node_modules/mad-openspec');
  await mkdir(installed, {recursive: true});
  await exec('tar', ['-xzf', path.join(root, manifest.filename), '--strip-components=1', '-C', installed]);
  // Use pinned local dependencies; the test needs no registry or network access.
  await symlink(path.join(checkout, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
  const bin = path.join(installed, 'dist/bin/mad-openspec.js');
  assert.equal((await success(root, bin, ['--version'])).stdout, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  assert.equal(JSON.parse((await success(empty, bin, ['setup', '--dry-run', '--json'])).stdout).toolchain, 'planned');
  assert.ok(manifest.files.some(file => file.path === 'docs/examples/story-dependencies/epics.md'));
  const docs = await readFile(path.join(installed, 'docs/usage.md'), 'utf8');
  const script = /node --input-type=module - [^\n]+ <<'JS'\n([\s\S]+?)\nJS/.exec(docs)?.[1];
  assert.ok(script);
  await exec(process.execPath, ['--input-type=module', '-e', script, '-', installed], {cwd: empty});
  await access(path.join(empty, '.agents/skills/mad-openspec-prepare/SKILL.md'));
  const f = await prepared(t, {cliBin: bin});
  await finishTasks(f);
  await success(f.root, bin, ['change', 'close', 'story-1-2']);
  const report = JSON.parse((await success(f.root, bin, ['status', '--json'])).stdout);
  assert.equal(report.stories.find((story: {storyId: string}) => story.storyId === '1.2').phase, 'closed');
  assert.equal(JSON.parse((await success(f.root, bin, ['dependencies', 'extract', '--json'])).stdout).stories.length, 2);
  assert.equal(JSON.parse((await success(f.root, bin, ['change', 'check', '--story', '1.2', '--json'])).stdout).dependencyState, 'ready');
  for (const name of ['mad-openspec-apply', 'mad-openspec-prepare']) {
    const skill = await readFile(path.join(installed, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, /change check --story/);
    assert.equal(await readFile(path.join(empty, '.agents/skills', name, 'SKILL.md'), 'utf8'), skill);
  }
  assert.equal(await readFile(path.join(empty, '.agents/skills/mad-openspec-guide/SKILL.md'), 'utf8'),
    await readFile(path.join(installed, 'skills/mad-openspec-guide/SKILL.md'), 'utf8'));
  assert.deepEqual((await readdir(path.join(installed, 'schemas'))).sort(), ['change-input.schema.json']);
});


test('real bins enforce current standalone dependencies and unblock after prerequisite close', async t => {
  const f = await prepared(t, {dependencyExample: true});
  const extract = JSON.parse((await success(f.root, cli, ['dependencies', 'extract', '--json'])).stdout);
  assert.deepEqual(extract.stories.map((s: {dependsOn: string[]}) => s.dependsOn), [[], ['1.1']]);
  const before = await snapshot(f.root);
  const blocked = await run(f.root, cli, ['change', 'check', '--story', '1.2', '--json']);
  assert.equal(blocked.code, 1); assert.equal(JSON.parse(blocked.stdout).dependencyState, 'blocked');
  assert.deepEqual(JSON.parse(blocked.stdout).blockedBy[0].chain, ['1.2', '1.1']);
  assert.deepEqual(await snapshot(f.root), before);
  const input = JSON.parse(await readFile(path.join(f.root, 'input.json'), 'utf8'));
  input.story.id = '1.1'; input.title = 'Показать здоровье во время боя'; input.capabilities[0].path = 'combat-health';
  await writeFile(path.join(f.root, 'prerequisite.json'), JSON.stringify(input));
  await success(f.root, cli, ['change', 'create', '--story', '1.1', '--input', 'prerequisite.json']);
  const prerequisite = {changeDir: path.join(f.root, 'openspec/changes/story-1-1')};
  await writeFile(path.join(prerequisite.changeDir, 'design.md'), await readFile(path.join(f.changeDir, 'design.md')));
  await finishTasks(prerequisite);
  assert.equal((await run(f.root, cli, ['change', 'check', '--story', '1.2', '--json'])).code, 1);
  await success(f.root, cli, ['change', 'close', 'story-1-1']);
  const ready = JSON.parse((await success(f.root, cli, ['change', 'check', '--story', '1.2', '--json'])).stdout);
  assert.equal(ready.dependencyState, 'ready'); assert.deepEqual(ready.blockedBy, []);
  const epics = path.join(f.root, f.paths.epics), original = await readFile(epics, 'utf8');
  await writeFile(epics, original.replace('Story 1.1; будущих stories нет.', 'Story 1.1; неизвестный остаток'));
  const unknownExtract = await run(f.root, cli, ['dependencies', 'extract', '--json']);
  assert.equal(unknownExtract.code, 1); assert.equal(JSON.parse(unknownExtract.stdout).stories[1].dependsOn, null);
  const unknown = await run(f.root, cli, ['change', 'check', '--story', '1.2', '--json']);
  assert.equal(unknown.code, 1); assert.equal(JSON.parse(unknown.stdout).dependencyState, 'unknown');
  assert.equal(JSON.parse((await success(f.root, cli, ['change', 'check', '--story', '1.1', '--json'])).stdout).dependencyState, 'ready');
  await writeFile(epics, original);
  assert.equal(JSON.parse((await success(f.root, cli, ['change', 'check', '--story', '1.2', '--json'])).stdout).dependencyState, 'ready');
});
