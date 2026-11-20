import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {configuredFixture, snapshot} from './helpers/project.ts';
import {runCli} from '../src/cli.ts';
import {cliVersion} from '../src/version.ts';

async function invoke(root: string, ...args: string[]) {
  let stdout = '', stderr = '';
  const code = await runCli(args, {cwd: root, stdout: text => {stdout += text;}, stderr: text => {stderr += text;}});
  return {code, stdout, stderr};
}

test('adopt a legacy connection, preview, repeat, then dispatch with the new pin', async t => {
  const {root, project} = await configuredFixture(t);
  const configPath = path.join(root, '.mad-openspec/config.json');
  const legacy = {...project.config, schemaVersion: 1, madOpenSpecVersion: undefined, custom: 'keep'};
  await writeFile(configPath, JSON.stringify(legacy));
  const step = {id: 'mad-openspec-skills', actual: '0.3.3', expected: '0.3.3', result: 'completed', action: 'install'};
  const receipt = path.join(root, '.mad-openspec/setup-state.json');
  await writeFile(receipt, JSON.stringify({schemaVersion: 1, settings: {}, steps: [step]}));
  const before = await snapshot(root);
  for (const args of [['status', '--json'], ['connect', '--json'], ['setup', '--dry-run', '--json'], ['change', 'check', '--story', '1.2', '--json']]) {
    const result = await invoke(root, ...args);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).issues[0].code, 'VERSION_MISMATCH');
    assert.match(result.stdout, /mad-openspec update/);
  }
  assert.equal((await invoke(root, '--version')).code, 0);
  const preview = await invoke(root, 'update', '--dry-run', '--json');
  assert.equal(preview.code, 0);
  assert.deepEqual(await snapshot(root), before);
  const update = await invoke(root, 'update', '--json');
  assert.equal(update.code, 0);
  assert.deepEqual(JSON.parse(update.stdout).files, JSON.parse(preview.stdout).files);
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(saved.custom, 'keep');
  assert.equal(saved.madOpenSpecVersion, cliVersion);
  assert.deepEqual(saved.bmad, project.config.bmad);
  assert.equal(JSON.parse(await readFile(receipt, 'utf8')).steps[0].actual, cliVersion);
  assert.equal((await invoke(root, 'change', 'check', '--story', '1.2', '--json')).code, 0);
  const migrated = await snapshot(root);
  const modifiedTimes = () => Promise.all(Object.keys(migrated).map(async file =>
    (await stat(path.join(root, file), {bigint: true})).mtimeNs));
  const times = await modifiedTimes();
  assert.deepEqual(JSON.parse((await invoke(root, 'update', '--json')).stdout).files, []);
  assert.deepEqual(await snapshot(root), migrated);
  assert.deepEqual(await modifiedTimes(), times);
});

test('local skill conflict, unsupported future release and empty project preserve files', async t => {
  const {root, project} = await configuredFixture(t);
  const dir = path.join(root, '.agents/skills/mad-openspec-close');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'SKILL.md'), 'local edits');
  const before = await snapshot(root);
  const conflict = await invoke(root, 'update', '--json');
  assert.equal(JSON.parse(conflict.stdout).issues[0].code, 'UPDATE_CONFLICT');
  assert.deepEqual(await snapshot(root), before);
  await writeFile(path.join(root, '.mad-openspec/config.json'), JSON.stringify({...project.config, madOpenSpecVersion: '9.0.0'}));
  for (const args of [['change','create','--story','1.2','--input','missing'], ['update']]) {
    const result = await invoke(root, ...args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /VERSION_MISMATCH.*9\.0\.0/);
  }
  await rm(path.join(root, '.mad-openspec'), {recursive:true});
  const untouched = await snapshot(root);
  assert.equal((await invoke(root, 'update')).code, 1);
  assert.deepEqual(await snapshot(root), untouched);
});

test('update before connect upgrades the setup receipt independently', async t => {
  const {root} = await configuredFixture(t);
  await rm(path.join(root, '.mad-openspec/config.json'));
  const receipt = path.join(root, '.mad-openspec/setup-state.json');
  await writeFile(receipt, JSON.stringify({schemaVersion: 1, settings: {}, steps: [
    {id: 'mad-openspec-skills', actual: null, expected: '0.3.4', action: 'skip', result: 'skipped'}
  ]}));
  assert.equal((await invoke(root, 'update')).code, 0);
  assert.equal(JSON.parse(await readFile(receipt, 'utf8')).steps[0].actual, cliVersion);
  assert.equal('.mad-openspec/config.json' in await snapshot(root), false);
});

test('update from 0.3.9 preserves TOML source and attaches the planning rule once per workflow', async t => {
  const {root, project} = await configuredFixture(t);
  const config = path.join(root, '.mad-openspec/config.json');
  await writeFile(config, JSON.stringify({...project.config, madOpenSpecVersion: '0.3.9'}));
  const custom = path.join(root, '_bmad/custom');
  await mkdir(custom, {recursive: true});
  const reference = 'file:{project-root}/.mad-openspec/bmad-planning.md';
  const cases = [
    ['bmad-prd', '[workflow] # team settings\r\npersistent_facts = [\r\n  "our fact", # keep\r\n]\r\n'],
    ['bmad-spec', 'workflow = { on_complete = "keep" }\n'],
    ['bmad-correct-course', 'workflow."persistent_facts" = ["fact"]\n'],
    ['bmad-create-epics-and-stories', '[workflow]\non_complete = "keep"\n']
  ];
  for (const [name, source] of cases) await writeFile(path.join(custom, name + '.toml'), source);
  // BMAD appends the personal array. A pre-existing personal reference is already effective.
  const personal = `[workflow]\npersistent_facts = ["personal", "${reference}"]\n`;
  await writeFile(path.join(custom, 'bmad-create-epics-and-stories.user.toml'), personal);
  const before = await snapshot(root);
  const preview = await invoke(root, 'update', '--dry-run', '--json');
  assert.equal(preview.code, 0, preview.stdout);
  assert.deepEqual(await snapshot(root), before);
  const result = await invoke(root, 'update', '--json');
  assert.deepEqual(JSON.parse(result.stdout).files, JSON.parse(preview.stdout).files);
  const [prd, spec, sprint, epics] = await Promise.all(cases.map(([name]) => readFile(path.join(custom, name + '.toml'), 'utf8')));
  assert.equal(prd, cases[0][1].replace('"our fact"', `"${reference}", "our fact"`));
  assert.equal(spec, cases[1][1].replace('on_complete', `persistent_facts = ["${reference}"], on_complete`));
  assert.equal(sprint, cases[2][1].replace('= [', `= ["${reference}", `));
  assert.equal(epics, cases[3][1]);
  assert.equal(await readFile(path.join(custom, 'bmad-create-epics-and-stories.user.toml'), 'utf8'), personal);
  assert.deepEqual(JSON.parse((await invoke(root, 'update', '--json')).stdout).files, []);
});

test('invalid team or personal customization blocks update before any writes', async t => {
  const {root} = await configuredFixture(t);
  const custom = path.join(root, '_bmad/custom');
  await mkdir(custom, {recursive: true});
  for (const [name, content] of [
    ['bmad-spec.toml', 'invalid TOML'],
    ['bmad-prd.user.toml', '[workflow]\npersistent_facts = "personal setting"']
  ]) {
    const file = path.join(custom, name);
    await writeFile(file, content);
    const before = await snapshot(root);
    const result = await invoke(root, 'update', '--json');
    assert.equal(JSON.parse(result.stdout).issues[0].code, 'UPDATE_CONFLICT');
    assert.match(result.stdout, new RegExp(name));
    assert.deepEqual(await snapshot(root), before);
    await rm(file);
  }
});
