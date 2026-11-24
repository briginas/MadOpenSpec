import type {Installers, SetupSettings} from '../src/types.ts';
import type {TestContext} from 'node:test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, mkdir, writeFile, readFile, readdir, stat, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openSkills, openSkillContent} from '../src/openspec-skills.ts';
import {snapshot} from './helpers/project.ts';
import {planningSkillIds} from '../src/bmad-profile.ts';
import {withProjectLock} from '../src/state.ts';
const api = await import('../src/setup.ts');
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'Mad setup пробел ')));
  t.after(() => rm(root, {recursive:true, force:true}));
  return root;
}
async function put(root: string, file: string, content='fixture\n') {
  await mkdir(path.dirname(path.join(root,file)), {recursive:true});
  await writeFile(path.join(root,file), content);
}
export async function bmadFixture(root: string, settings: Partial<SetupSettings>={}) {
  await put(root,'_bmad/_config/manifest.yaml','installation:\n  version: 6.12.4\nmodules:\n  - name: core\n    version: 6.12.4\n  - name: bmm\n    version: 6.12.4\nides: [codex]\n');
  for (const f of ['core/module-help.csv','bmm/module-help.csv','scripts/resolve_config.py','scripts/config_utils.py','scripts/render_skill.py','scripts/resolve_customization.py']) await put(root,`_bmad/${f}`);
  const ids = settings.bmadProfile === 'planning' ? [...planningSkillIds, 'bmad-build'] : ['bmad-help'];
  const skillRows = [], fileRows = [];
  for (const id of ids) {
    const skill = `core/${id}/SKILL.md`;
    skillRows.push(`${id},${id},Help,core,_bmad/${skill}`);
    fileRows.push(`md,help,core,${skill},unused`);
    await put(root,`.agents/skills/${id}/SKILL.md`);
  }
  await put(root,'_bmad/_config/skill-manifest.csv',['canonicalId,name,description,module,path', ...skillRows, ''].join('\n'));
  await put(root,'_bmad/_config/files-manifest.csv',['type,name,module,path,hash', ...fileRows, ''].join('\n'));
  for (const file of ['core/module-help.csv', 'bmm/module-help.csv', '_config/bmad-help.csv']) {
    await put(root, `_bmad/${file}`, ['module,skill', 'core,_meta', ...ids.map(id => `core,${id}`), ''].join('\n'));
  }
  await put(root,'_bmad/core/bmad-help/SKILL.md');
  await put(root,'_bmad/config.toml',`[core]\nuser_name = ${JSON.stringify(settings.userName??'Developer')}\ncommunication_language = ${JSON.stringify(settings.communicationLanguage??'Russian')}\ndocument_output_language = ${JSON.stringify(settings.documentOutputLanguage??'Russian')}\noutput_folder = "_bmad-output"\n`);
}
async function openFixture(root: string) {
  await put(root,'openspec/config.yaml','schema: spec-driven\n');
  await put(root,'.agents/skills/.openspec-target','codex\n');
  for (const name of openSkills) await put(root,`.agents/skills/${name}/SKILL.md`, await openSkillContent(name));
}
function installers({failOpen=false,emptyBmad=false}={}): Installers & {calls: string[]} {
  const calls: string[]=[];
  return {calls, bmad:async(root,settings)=>{calls.push('bmad');if(!emptyBmad) await bmadFixture(root,settings);},openspec:async(root)=>{calls.push('openspec');if(failOpen) throw new Error('installer failed');await openFixture(root);}};
}
async function setup(root: string, options: Parameters<typeof api.setupProject>[1]={}, deps: Parameters<typeof api.setupProject>[2]={}) {
  assert.equal(typeof api.setupProject,'function','setupProject must exist');
  return api.setupProject(root,options,deps);
}
test('setup dry-run is read-only and ignores backlog',async t=>{
  const root=await fixture(t);await put(root,'planning/epics.md','invalid backlog');const before=await snapshot(root);const i=installers();
  const r=await setup(root,{dryRun:true},{installers:i});assert.equal(r.toolchain,'planned');assert.deepEqual(i.calls,[]);assert.deepEqual(await snapshot(root),before);assert.deepEqual(r.issues,[]);assert.equal(r.schemaVersion,1);assert.equal('integration' in r,false);
});
test('setup installs tools without connecting and repeats without permanent writes',async t=>{
  const root=await fixture(t),i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.deepEqual(i.calls,['bmad','openspec']);
  assert.equal(await readFile(path.join(root,'.agents/skills/mad-openspec-guide/SKILL.md'),'utf8'),await readFile(new URL('../skills/mad-openspec-guide/SKILL.md',import.meta.url),'utf8'));
  assert.equal((await readdir(path.join(root,'.mad-openspec'))).includes('config.json'),false);
  const before=await snapshot(root);const mtime=(await stat(path.join(root,'.mad-openspec/setup-state.json'))).mtimeMs;
  const repeat=await setup(root,{}, {installers:i});assert.equal(repeat.toolchain,'ready');assert.deepEqual(i.calls,['bmad','openspec']);assert.deepEqual(await snapshot(root),before);assert.equal((await stat(path.join(root,'.mad-openspec/setup-state.json'))).mtimeMs,mtime);
});
test('setup adds guide to an existing installation without changing other skills',async t=>{
  const root=await fixture(t),i=installers();assert.equal((await setup(root,{}, {installers:i})).toolchain,'ready');
  await rm(path.join(root,'.agents/skills/mad-openspec-guide'),{recursive:true});
  const before=await snapshot(root);i.calls.length=0;
  const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.deepEqual(i.calls,[]);
  assert.equal(await readFile(path.join(root,'.agents/skills/mad-openspec-guide/SKILL.md'),'utf8'),await readFile(new URL('../skills/mad-openspec-guide/SKILL.md',import.meta.url),'utf8'));
  const after=await snapshot(root);
  for(const [file,content]of Object.entries(before))if(file!=='.mad-openspec/setup-state.json')assert.equal(after[file],content,file);
});
test('setup skips existing BMAD and preserves custom settings',async t=>{
  const root=await fixture(t);await bmadFixture(root,{userName:'Alice'});const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.deepEqual(i.calls,['openspec']);
  const before=await snapshot(root);const conflict=await setup(root,{userName:'Bob'}, {installers:i});assert.equal(conflict.toolchain,'blocked');assert.deepEqual(await snapshot(root),before);
});
test('planning setup preserves existing project output and checks the saved profile on repeat', async t => {
  const root = await fixture(t), i = installers();
  await put(root, '_bmad-output/planning-artifacts/prd.md', 'original PRD');
  await put(root, '.agents/skills/local-tool/SKILL.md', 'local skill');
  const result = await setup(root, {}, {installers:i});
  assert.equal(result.toolchain, 'ready');
  assert.equal(result.steps[0].profile, 'planning');
  assert.equal(await readFile(path.join(root, '_bmad-output/planning-artifacts/prd.md'), 'utf8'), 'original PRD');
  assert.equal(await readFile(path.join(root, '.agents/skills/local-tool/SKILL.md'), 'utf8'), 'local skill');
  const before = await snapshot(root);
  assert.equal((await setup(root, {bmadProfile:'full'}, {installers:i})).toolchain, 'blocked');
  assert.deepEqual(await snapshot(root), before);
  const manifest = path.join(root, '_bmad/_config/skill-manifest.csv');
  await writeFile(manifest, (await readFile(manifest, 'utf8')).split('\n').filter(line => !line.includes('bmad-review')).join('\n'));
  assert.equal((await setup(root, {}, {installers:i})).toolchain, 'blocked');
  assert.deepEqual(i.calls, ['bmad', 'openspec']);
});
test('incomplete legacy installation rejects migration during preflight', async t => {
  const root = await fixture(t), i = installers();
  await bmadFixture(root);
  const before = await snapshot(root);
  const result = await setup(root, {bmadProfile:'planning'}, {installers:i});
  assert.equal(result.toolchain, 'blocked');
  assert.deepEqual(i.calls, []);
  assert.deepEqual(await snapshot(root), before);
  assert.equal((await setup(root, {dryRun:true}, {installers:i})).steps[0].profile, 'full');
});
test('setup preflight rejects partial or incompatible BMAD before installing anything',async t=>{
  for(const content of ['installation:\n  version: 7.0.0\n','installation:\n  version: 6.12.4\n']) {
    const root=await fixture(t);await put(root,'_bmad/_config/manifest.yaml',content);const before=await snapshot(root),i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);assert.deepEqual(await snapshot(root),before);
  }
});
test('setup rejects modified MadOpenSpec skills before any installers',async t=>{
  for(const name of ['mad-openspec-prepare','mad-openspec-guide']) {
    const root=await fixture(t);await put(root,`.agents/skills/${name}/SKILL.md`,'custom');const before=await snapshot(root),i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);assert.deepEqual(await snapshot(root),before);
  }
});
test('setup refuses external symlinks and project lock',async t=>{
  const root=await fixture(t),outside=await fixture(t),i=installers();await symlink(outside,path.join(root,'_bmad'));const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.equal(r.issues[0].code,'UNSAFE_PATH');assert.deepEqual(i.calls,[]);
  const second=await fixture(t);await withProjectLock(second,async()=>{const locked=await setup(second,{}, {installers:i});assert.equal(locked.issues[0].code,'PROJECT_LOCKED');});
});
test('setup stops after failure and skips confirmed component on retry',async t=>{
  const root=await fixture(t),i=installers({failOpen:true});const failed=await setup(root,{}, {installers:i});assert.equal(failed.toolchain,'failed');assert.equal(failed.steps[0].result,'completed');assert.equal(failed.steps[1].result,'failed');assert.equal(failed.steps[2].result,'not-run');
  const retry=installers();assert.equal((await setup(root,{}, {installers:retry})).toolchain,'ready');assert.deepEqual(retry.calls,['openspec']);
});
test('setup verifies disk result even after successful installer exit',async t=>{
  const root=await fixture(t),i=installers({emptyBmad:true});const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'failed');assert.deepEqual(i.calls,['bmad']);assert.equal(r.steps[0].result,'failed');
});
test('setup preserves existing integration and registry including invalid backlog',async t=>{
  const root=await fixture(t);await put(root,'.mad-openspec/config.json','existing integration');await put(root,'.mad-openspec/registry.json','existing registry');await put(root,'epics.md','invalid');const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.equal(await readFile(path.join(root,'.mad-openspec/config.json'),'utf8'),'existing integration');assert.equal(await readFile(path.join(root,'.mad-openspec/registry.json'),'utf8'),'existing registry');
});
test('setup rejects stores and custom schemas before BMAD installation',async t=>{
  for(const config of ['store: other\n','schema: custom\n']) {const root=await fixture(t);await put(root,'openspec/config.yaml',config);const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);}
});
test('setup accepts BMAD skills relocated into Codex by upstream cleanup',async t=>{
  const root=await fixture(t);await bmadFixture(root);await rm(path.join(root,'_bmad/core/bmad-help'),{recursive:true});const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.deepEqual(i.calls,['openspec']);
});
test('setup preflight detects nested external skill symlinks before fresh installation',async t=>{
  const root=await fixture(t),outside=await fixture(t);await mkdir(path.join(root,'.agents/skills'),{recursive:true});await symlink(outside,path.join(root,'.agents/skills/bmad-help'));const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);
});
test('setup configures missing OpenSpec skills while preserving existing files',async t=>{
  const root=await fixture(t);await openFixture(root);await rm(path.join(root,'.agents/skills/openspec-explore'),{recursive:true});await put(root,'openspec/config.yaml','schema: spec-driven\ncontext: preserve-me\n');const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.match(await readFile(path.join(root,'openspec/config.yaml'),'utf8'),/preserve-me/);assert.equal(await readFile(path.join(root,'.agents/skills/openspec-propose/SKILL.md'),'utf8'),await openSkillContent('openspec-propose'));
});
test('setup reads user and custom overrides without requiring Python',async t=>{
  const root=await fixture(t);await bmadFixture(root);await put(root,'_bmad/config.user.toml','[core]\nuser_name = "Personal"\n');await put(root,'_bmad/custom/config.toml','[core]\nuser_name = "Team"\n');await put(root,'_bmad/custom/config.user.toml','[core]\nuser_name = "Final"\n');
  const i=installers();const r=await setup(root,{userName:'Final'}, {installers:i});assert.equal(r.toolchain,'ready');assert.deepEqual(i.calls,['openspec']);
  const before=await snapshot(root);await put(root,'_bmad/custom/config.toml','invalid TOML');const failed=await setup(root,{}, {installers:i});assert.equal(failed.toolchain,'blocked');assert.equal(await readFile(path.join(root,'_bmad/config.user.toml'),'utf8'),before['_bmad/config.user.toml']);
});
test('setup records unknown partial installer output as requiring manual recovery',async t=>{
  const root=await fixture(t),i=installers();i.bmad=async()=>{await put(root,'_bmad/partial','unknown');throw new Error('interrupted');};assert.equal((await setup(root,{bmadProfile:'full'}, {installers:i})).toolchain,'failed');
  const retry=installers();const result=await setup(root,{}, {installers:retry});assert.equal(result.toolchain,'blocked');assert.equal(result.issues[0].code,'SETUP_RECOVERY_REQUIRED');assert.deepEqual(retry.calls,[]);
});
test('setup never overwrites orphan BMAD or OpenSpec skills during fresh install',async t=>{
  for(const name of ['bmad-help','openspec-propose']){const root=await fixture(t);await put(root,`.agents/skills/${name}/SKILL.md`,'custom orphan');const before=await snapshot(root),i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);assert.deepEqual(await snapshot(root),before);}
});
test('documented manual skill installation skips identical and refuses different files',async t=>{
  const root=await fixture(t);const {fileURLToPath}=await import('node:url');const {execute}=await import('../src/installers.ts');
  const docs=await readFile(new URL('../docs/usage.md',import.meta.url),'utf8');const script=/node --input-type=module - [^\n]+ <<'JS'\n([\s\S]+?)\nJS/.exec(docs)?.[1];assert.ok(script);
  const packageDir=fileURLToPath(new URL('../',import.meta.url));const args=['--input-type=module','-e',script,'-',packageDir];
  assert.equal((await execute(process.execPath,args,{cwd:root})).code,0);const before=await snapshot(root);assert.equal((await execute(process.execPath,args,{cwd:root})).code,0);assert.deepEqual(await snapshot(root),before);
  assert.equal(await readFile(path.join(root,'.agents/skills/mad-openspec-guide/SKILL.md'),'utf8'),await readFile(new URL('../skills/mad-openspec-guide/SKILL.md',import.meta.url),'utf8'));
  await put(root,'.agents/skills/mad-openspec-prepare/SKILL.md','custom');assert.equal((await execute(process.execPath,args,{cwd:root})).code,1);assert.equal(await readFile(path.join(root,'.agents/skills/mad-openspec-prepare/SKILL.md'),'utf8'),'custom');
});
test('setup refuses a different saved OpenSpec root before installing',async t=>{
  const root=await fixture(t),i=installers();assert.equal((await setup(root,{}, {installers:i})).toolchain,'ready');const before=await snapshot(root);
  const r=await setup(root,{openspecRoot:'other'}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(await snapshot(root),before);assert.deepEqual(i.calls,['bmad','openspec']);
});
test('setup detects a missing nested BMAD skill asset listed in files manifest',async t=>{
  const root=await fixture(t);await bmadFixture(root);await put(root,'_bmad/_config/files-manifest.csv','type,name,module,path,hash\nmd,help,core,core/bmad-help/SKILL.md,unused\nmd,step,core,core/bmad-help/steps/step-01.md,unused\n');const i=installers();const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'blocked');assert.deepEqual(i.calls,[]);
});
test('setup stages OpenSpec installer so existing project instructions are untouched',async t=>{
  const root=await fixture(t),i=installers();await put(root,'AGENTS.md','custom instructions\n<!-- OPENSPEC:START -->\nlegacy\n<!-- OPENSPEC:END -->\n');const original=await readFile(path.join(root,'AGENTS.md'),'utf8');
  const base=i.openspec;i.openspec=async target=>{if(target===root)await put(root,'AGENTS.md','rewritten by upstream');await base(target);};
  const r=await setup(root,{}, {installers:i});assert.equal(r.toolchain,'ready');assert.equal(await readFile(path.join(root,'AGENTS.md'),'utf8'),original);
});
