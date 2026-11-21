import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {readyChangeFixture, makeProjectFixture} from './helpers/project.ts';
const mod = await import('../src/cli.ts');
async function invoke(argv: string[], cwd: string, openspec?: import('../src/types.ts').OpenSpec, stdoutIsTTY = false) {
  let stdout = '', stderr = '';
  assert.equal(typeof mod.runCli, 'function');
  const code = await mod.runCli(argv, {cwd, openspec, stdoutIsTTY, stdout: text => {stdout += text;}, stderr: text => {stderr += text;}});
  return {stdout, stderr, code};
}
test('cli-help-without-project', async t => {
  const {root} = await makeProjectFixture(t);
  const help = await invoke(['--help'], root);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /change create/);
  const version = await invoke(['--version'], root);
  assert.equal(version.code, 0);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.stdout, `${manifest.version}\n`);
});
test('cli-invalid-arguments-exit-two', async t => {
  const {root} = await makeProjectFixture(t);
  for (const argv of [[], ['unknown'], ['status', '--bogus'], ['change', 'create', '--story', '1.2'], ['change', 'close'], ['change', 'close', 'story-1-2', 'extra'], ['init'], ['status', '--json', '--json']]) {
    const result = await invoke(argv, root);
    assert.equal(result.code, 2, JSON.stringify(argv));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /INVALID_ARGUMENTS/);
  }
});
test('compact status lists open stories and counts unstarted stories', async t => {
  const {root, adapter} = await readyChangeFixture(t);
  const json = await invoke(['status', '--json'], root, adapter);
  const text = await invoke(['status'], root, adapter);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(text.code, json.code);
  assert.match(text.stdout, /историй: 2.*не начаты: 1/);
  assert.ok(!text.stdout.includes(report.stories[0].title));
  assert.ok(text.stdout.includes(report.stories[1].title));
  assert.ok(text.stdout.includes(report.stories[1].changeId));
  assert.match(text.stdout, /6\/6/);
});
test('story progress follows current OpenSpec order and checkboxes', async t => {
  const {root, changeDir} = await readyChangeFixture(t);
  const args = ['change', 'progress', '--story', '1.2'];
  const file = path.join(changeDir, 'tasks.md');
  const checklist = '- [ ] 1.1 First\n- [x] 1.2 Second\n- [ ] 1.3 Third\n';
  await writeFile(file, checklist);
  const partial = await invoke(args, root);
  assert.deepEqual(partial, {
    code: 0, stderr: '',
    stdout: 'Прогресс по истории 1.2 · готово 1 из 3\n\n→ 1.1 First\n✓ 1.2 Second\n○ 1.3 Third\n'
  });
  assert.deepEqual(await invoke(args, root), partial);
  await writeFile(file, checklist.replaceAll('[ ]', '[x]'));
  assert.deepEqual(await invoke(args, root), {
    code: 0, stderr: '',
    stdout: 'Прогресс по истории 1.2 · готово 3 из 3\n\n✓ 1.1 First\n✓ 1.2 Second\n✓ 1.3 Third\n'
  });
});
test('epic checklist follows current story states and highlights only verified closure', async t => {
  const {root, paths, changeDir, adapter} = await readyChangeFixture(t);
  const epic = (...flags: string[]) => invoke(['status', '--epic', '1', ...flags], root, adapter);
  const annotated = () => epic('--just-closed', '1.2');
  const tasks = path.join(changeDir, 'tasks.md');
  const sprint = path.join(root, paths.sprintStatus);
  const backlog = path.join(root, paths.epics);
  const doneTasks = await readFile(tasks, 'utf8');
  const initialSprint = await readFile(sprint, 'utf8');
  await writeFile(sprint, initialSprint.replace('backlog # other story', 'in-progress # other story'));
  await writeFile(tasks, doneTasks.replace('[x]', '[ ]'));
  assert.deepEqual(await epic(), {code: 0, stderr: '', stdout:
    'Прогресс по эпику 1 — Команда · закрыто 0 из 2\n\n→ 1.1 Создать команду — в работе\n→ 1.2 Пригласить участника — в работе, задачи 5/6\n'});
  await writeFile(tasks, doneTasks);
  await writeFile(sprint, initialSprint);
  await writeFile(backlog, (await readFile(backlog, 'utf8')).replace('**Dependencies:** none', '**Dependencies:** Story 1.2'));
  assert.match((await epic()).stdout, /○ 1\.1 Создать команду — ожидает 1\.2\n○ 1\.2 Пригласить участника — задачи выполнены, ожидает закрытия/);
  assert.equal((await annotated()).code, 1);
  assert.equal((await invoke(['change', 'close', 'story-1-2'], root, adapter)).code, 0);
  assert.deepEqual(await annotated(), {code: 0, stderr: '', stdout:
    'Прогресс по эпику 1 — Команда · закрыто 1 из 2\n\n○ 1.1 Создать команду — не начата\n✓ 1.2 Пригласить участника — закрыта сейчас\n'});
  await writeFile(sprint, (await readFile(sprint, 'utf8')).replace('backlog # other story', 'done # other story'));
  assert.deepEqual(await annotated(), {code: 0, stderr: '', stdout:
    'Прогресс по эпику 1 — Команда · закрыто 2 из 2\n\n✓ 1.1 Создать команду\n✓ 1.2 Пригласить участника — закрыта сейчас\n'});
  assert.doesNotMatch((await epic()).stdout, /закрыта сейчас/);
  assert.equal((await epic('--just-closed', '1.1')).code, 1);
});
test('epic checklist handles empty, absent and unreadable backlogs and validates selection', async t => {
  const {root, paths, adapter} = await readyChangeFixture(t);
  const status = (...flags: string[]) => invoke(['status', ...flags], root, adapter);
  assert.deepEqual(await status('--epic', '2'), {code: 0, stderr: '', stdout:
    'Прогресс по эпику 2 — Отчёты · закрыто 0 из 0\n\nИсторий пока нет.\n'});
  for (const flags of [['--epic', '0'], ['--epic', '1', '--json'], ['--epic', '1', '--summary'], ['--just-closed', '1.2'], ['--epic', '1', '--just-closed', '2.1']]) {
    assert.equal((await status(...flags)).code, 2);
  }
  const absent = await status('--epic', '3');
  assert.equal(absent.code, 1);
  assert.match(absent.stderr, /EPIC_NOT_FOUND/);
  await unlink(path.join(root, paths.epics));
  const unavailable = await status('--epic', '1');
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.stdout, '');
  assert.ok(unavailable.stderr);
});
test('story progress prints diagnostics without a checklist when unavailable', async t => {
  const {root, adapter, changeDir} = await readyChangeFixture(t);
  const progress = (story: string) => invoke(['change', 'progress', '--story', story], root, adapter);
  await writeFile(path.join(changeDir, 'tasks.md'), '# Tasks\n');
  const empty = await progress('1.2');
  assert.equal(empty.code, 1);
  assert.equal(empty.stdout, '');
  assert.match(empty.stderr, /EMPTY_TASKS/);
  const missing = await progress('1.1');
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /UNLINKED_STORY/);
  assert.equal((await progress('bad')).code, 2);
});
test('compact and epic views group missing fields and color only terminal labels', async t => {
  const {root, paths, changeDir, adapter} = await readyChangeFixture(t);
  const epics = path.join(root, paths.epics);
  const sprint = path.join(root, paths.sprintStatus);
  const additional = Array.from({length: 8}, (_, i) => i + 1);
  await writeFile(epics, (await readFile(epics, 'utf8')).replace('**Dependencies:** none', '')
    + additional.map(id => `### Story 2.${id}: Later ${id}\n`).join(''));
  await writeFile(sprint, await readFile(sprint, 'utf8') + additional.map(id => `  2-${id}-later: backlog\n`).join(''));
  await writeFile(path.join(changeDir, 'tasks.md'), Array.from({length: 7}, (_, i) => `- [ ] 1.${i + 1} Task`).join('\n'));
  const {NO_COLOR, TERM} = process.env;
  t.after(() => {
    if (NO_COLOR === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = NO_COLOR;
    if (TERM === undefined) delete process.env.TERM; else process.env.TERM = TERM;
  });
  process.env.TERM = 'xterm';
  for (const flags of [[], ['--summary']]) {
    delete process.env.NO_COLOR;
    const args = ['status', ...flags];
    const plain = await invoke(args, root, adapter);
    const tty = await invoke(args, root, adapter, true);
    assert.equal(plain.code, 0);
    assert.match(plain.stdout, /подготовлены: 1 · не начаты: 9/);
    assert.match(plain.stdout, /подготовлена · story-1-2 · задачи 0\/7 · прямых зависимостей нет/);
    assert.match(plain.stdout, /Dependencies: 9 \(1\.1, 2\.1–2\.8\)/);
    assert.equal(plain.stdout.split('Зависимости не указаны').length, 2);
    assert.doesNotMatch(plain.stdout, /DEPENDENCIES_FIELD_MISSING|\[\]/);
    assert.equal(plain.stdout.includes('Later 8'), flags.includes('--summary'));
    assert.equal(stripVTControlCharacters(tty.stdout), plain.stdout);
    assert.match(tty.stdout, /\x1b\[34mподготовлена\x1b\[39m/);
    assert.match(tty.stdout, /\x1b\[33mЗависимости не указаны\x1b\[39m/);
    const json = await invoke([...args, '--json'], root, adapter, true);
    assert.equal(JSON.parse(json.stdout).stories.length, 10);
    assert.equal(json.stdout, (await invoke([...args, '--json'], root, adapter)).stdout);
    process.env.NO_COLOR = '1';
    assert.equal((await invoke(args, root, adapter, true)).stdout, plain.stdout);
  }
});
test('json-stdout-is-clean', async t => {
  const {root, adapter} = await readyChangeFixture(t);
  adapter.tasks = async () => {throw Object.assign(new Error('native diagnostic'), {code: 'OPENSPEC_FAILED'});};
  const result = await invoke(['status', '--json'], root, adapter);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
  assert.equal(JSON.parse(result.stdout).stories[1].tasks, null);
  await writeFile(path.join(root, '.mad-openspec/config.json'), '{bad');
  const corrupt = await invoke(['status', '--json'], root, adapter);
  assert.equal(corrupt.code, 1);
  assert.equal(JSON.parse(corrupt.stdout).issues[0].code, 'INVALID_CONFIG');
});
test('setup CLI supports dry-run JSON without integration and rejects invalid arguments',async t=>{
  const {mkdtemp,realpath,rm,readdir}=await import('node:fs/promises');const os=await import('node:os');
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'mad-cli-setup-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const result=await invoke(['setup','--dry-run','--json'],root);assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).toolchain,'planned');assert.deepEqual(await readdir(root),[]);
  for(const argv of [['setup','--bad','--json'],['setup','--bmad-profile','unknown','--json'],['setup','--user-name',''],['setup','--dry-run','--dry-run']])assert.equal((await invoke(argv,root)).code,2);
  await writeFile(path.join(root,'file'),'x');
  assert.match((await invoke(['setup','--help'],root)).stdout,/setup/);
});
test('connect replaces init and accepts explicit paths without Python',async t=>{
  const {root,paths}=await makeProjectFixture(t);const {fakeOpenSpec}=await import('./helpers/openspec.ts');const adapter=fakeOpenSpec(root);
  const old=await invoke(['init'],root,adapter);assert.equal(old.code,2);assert.match(old.stderr,/connect/);
  const r=await invoke(['connect','--epics',paths.epics,'--sprint-status',paths.sprintStatus,'--bmad-manifest',paths.manifest,'--openspec-root','.','--json'],root,adapter);assert.equal(r.code,0);assert.equal(JSON.parse(r.stdout).sources.epics.origin,'explicit');
});
test('connect operational errors produce one JSON report',async t=>{
  const {root}=await makeProjectFixture(t);const {fakeOpenSpec}=await import('./helpers/openspec.ts');const adapter=fakeOpenSpec(root);
  // Explicit missing document bypasses the resolver and still produces one JSON error.
  const r=await invoke(['connect','--epics','missing.md','--sprint-status','planning/sprint-status.yaml','--json'],root,adapter);assert.equal(r.code,1);assert.equal(JSON.parse(r.stdout).issues.length,1);assert.equal(r.stderr,'');
});

test('dependency CLI contracts, local results, source refresh, readonly and JSON errors', async t => {
  const {configuredFixture, snapshot} = await import('./helpers/project.ts');
  const {rm} = await import('node:fs/promises');
  const {root, paths, adapter} = await configuredFixture(t);
  const epics = path.join(root, paths.epics);
  await writeFile(epics, await readFile(new URL('../docs/examples/story-dependencies/epics.md', import.meta.url)));
  const before = await snapshot(root);
  let extracted = await invoke(['dependencies', 'extract', '--json'], root);
  assert.equal(extracted.code, 0); assert.equal(extracted.stderr, '');
  assert.deepEqual(JSON.parse(extracted.stdout).stories.map((s: {dependsOn: string[]}) => s.dependsOn), [[], ['1.1']]);
  let check = await invoke(['change', 'check', '--story', '1.2', '--json'], root);
  assert.equal(check.code, 1); assert.equal(check.stderr, '');
  const report = JSON.parse(check.stdout); assert.equal(report.dependencyState, 'blocked');
  assert.deepEqual(report.blockedBy[0].chain, ['1.2', '1.1']); assert.equal(report.blockedBy[0].bmadStatus, 'backlog');
  const text = await invoke(['change', 'check', '--story', '1.2'], root);
  assert.match(text.stdout, /Story 1.2 заблокирована: сначала выполните story 1.1/); assert.match(text.stdout, /Show health during combat/);
  let status = await invoke(['status', '--json'], root, adapter);
  assert.equal(status.code, 0); assert.deepEqual(JSON.parse(status.stdout).stories[1].blockedBy, report.blockedBy);
  assert.deepEqual(JSON.parse(status.stdout).stories[1].issues, []);
  assert.deepEqual(await snapshot(root), before);
  const original = await readFile(epics, 'utf8');
  await writeFile(epics, original.replace('Story 1.1; будущих stories нет.', 'Story 1.1; неизвестный хвост'));
  extracted = await invoke(['dependencies', 'extract', '--json'], root); assert.equal(extracted.code, 1);
  assert.equal(JSON.parse(extracted.stdout).stories[1].dependsOn, null);
  check = await invoke(['change', 'check', '--story', '1.2', '--json'], root); assert.equal(JSON.parse(check.stdout).dependencyState, 'unknown');
  const independent = await invoke(['change', 'check', '--story', '1.1', '--json'], root); assert.equal(independent.code, 0);
  status = await invoke(['status', '--json'], root, adapter); assert.equal(status.code, 1);
  assert.equal(JSON.parse(status.stdout).stories[0].dependencyState, 'ready'); assert.equal(JSON.parse(status.stdout).stories[1].dependsOn, null);
  await writeFile(epics, original.replace('Story 1.1; будущих stories нет.', 'Story 9.1'));
  const invalid = await invoke(['status', '--json'], root, adapter);
  assert.equal(invalid.code, 1); assert.equal(JSON.parse(invalid.stdout).stories[1].dependencyState, 'invalid');
  assert.equal(JSON.parse(invalid.stdout).stories[0].dependencyState, 'ready');
  assert.ok(JSON.parse(invalid.stdout).stories[1].issues.some((i: {code: string}) => i.code === 'DEPENDENCY_STORY_MISSING'));
  await writeFile(epics, original.replace('Story 1.1; будущих stories нет.', 'Story 1.1; неизвестный хвост'));
  // A chat answer is not a parser override: until bytes change, repeated checks remain unknown.
  assert.equal(JSON.parse((await invoke(['change', 'check', '--story', '1.2', '--json'], root)).stdout).dependencyState, 'unknown');
  const help = (await invoke(['--help'], root)).stdout;
  assert.match(help, /dependencies extract/); assert.match(help, /change check/); assert.doesNotMatch(help, /dependencies (set|register|import)/);
  for (const args of [['dependencies', 'extract', '--bogus', '--json'], ['dependencies', 'extract', '--json', '--json'], ['change', 'check', '--json'], ['change', 'check', '--story', 'bad', '--json'], ['change', 'check', '--story', '1.2', '--input', 'graph.json', '--json']]) {
    const result = await invoke(args, root); assert.equal(result.code, 2); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).issues[0].code, 'INVALID_ARGUMENTS');
  }
  await rm(path.join(root, paths.sprintStatus)); await writeFile(path.join(root, '.mad-openspec/registry.json'), '{bad');
  await writeFile(epics, original);
  assert.equal((await invoke(['dependencies', 'extract', '--json'], root)).code, 0);
  check = await invoke(['change', 'check', '--story', '1.2', '--json'], root); assert.equal(check.code, 1); assert.equal(JSON.parse(check.stdout).dependencyState, 'unknown');
  await rm(epics);
  extracted = await invoke(['dependencies', 'extract', '--json'], root); assert.equal(extracted.code, 1); assert.equal(JSON.parse(extracted.stdout).issues.length, 1);
  await writeFile(path.join(root, '.mad-openspec/config.json'), '{bad');
  for (const args of [['dependencies', 'extract', '--json'], ['change', 'check', '--story', '1.2', '--json']]) {
    const result = await invoke(args, root); assert.equal(result.code, 1); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).issues[0].code, 'INVALID_CONFIG');
  }
});

test('CLI refuses a ready result when backlog, sprint or registry changes during check', async t => {
  const fs = (await import('node:fs/promises')).default;
  const {syncBuiltinESMExports} = await import('node:module');
  const {configuredFixture} = await import('./helpers/project.ts');
  const f = await configuredFixture(t), originalRead = fs.readFile;
  for (const relative of [f.paths.epics, f.paths.sprintStatus, '.mad-openspec/registry.json']) {
    const target = path.join(f.root, relative);
    let old: Buffer | null = null;
    try {old = await originalRead(target);} catch {}
    let fired = false;
    const mock = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
      const result = await (originalRead as Function)(...args);
      if (!fired && String(args[0]) === path.join(f.root, f.paths.sprintStatus)) {
        fired = true; await fs.writeFile(target, old === null ? '{"schemaVersion":1,"stories":{}}' : Buffer.concat([old, Buffer.from('\n')]));
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      const result = await invoke(['change', 'check', '--story', '1.1', '--json'], f.root);
      assert.equal(result.code, 1); const report = JSON.parse(result.stdout);
      assert.equal(report.dependencyState, 'unknown'); assert.ok(report.issues.some((i: {code: string}) => i.code === 'SOURCE_CHANGED'));
    } finally {mock.mock.restore(); syncBuiltinESMExports(); if (old === null) await fs.rm(target); else await fs.writeFile(target, old);}
  }
});
