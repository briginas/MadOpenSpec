import {CliError} from '../src/errors.ts';
import type {TestContext} from 'node:test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,copyFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {makeProjectFixture,snapshot} from './helpers/project.ts';
import {fakeOpenSpec} from './helpers/openspec.ts';
import {withProjectLock} from '../src/state.ts';
const api=await import('../src/connect.ts');
async function put(root: string,file: string,text: string){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),text);}
async function fixture(t: TestContext){
  const f=await makeProjectFixture(t,{prefix:'Mad connect пробел '});
  const scripts=path.join(path.dirname(createRequire(import.meta.url).resolve('bmad-method')),'../../src/scripts');
  await mkdir(path.join(f.root,'_bmad/scripts'),{recursive:true});
  for(const file of ['resolve_config.py','config_utils.py'])await copyFile(path.join(scripts,file),path.join(f.root,'_bmad/scripts',file));
  await put(f.root,'_bmad/config.toml','[core]\noutput_folder = "_bmad-output"\n[modules.bmm]\nplanning_artifacts = "{project-root}/planning"\nimplementation_artifacts = "{project-root}/planning"\n');
  return {...f,adapter:fakeOpenSpec(f.root)};
}
async function connect(f: Awaited<ReturnType<typeof fixture>>,options: Parameters<typeof api.connectProject>[1]={},deps: Parameters<typeof api.connectProject>[2]={}){assert.equal(typeof api.connectProject,'function');return api.connectProject(f.root,options,{openspec:f.adapter,...deps});}
test('connect discovers documents using real BMAD resolver and reports path origins',async t=>{
  const f=await fixture(t);const r=await connect(f);assert.equal(r.config.bmad.epics,'planning/epics.md');assert.equal(r.config.bmad.sprintStatus,'planning/sprint-status.yaml');assert.equal(r.sources.epics.origin,'bmad-config');assert.equal(r.sources.manifest.origin,'default');assert.equal(await readFile(path.join(f.root,'.mad-openspec/config.json'),'utf8').then(JSON.parse).then(c=>c.schemaVersion),2);
});
test('resolver uses all four TOML layers and leaves no Python cache',async t=>{
  const f=await fixture(t);await put(f.root,'_bmad/config.user.toml','[core]\noutput_folder = "personal"\n');await put(f.root,'_bmad/custom/config.toml','[modules.bmm]\nplanning_artifacts = "{project-root}/team"\n');await put(f.root,'_bmad/custom/config.user.toml','[modules.bmm]\nplanning_artifacts = "{project-root}/planning"\n');
  assert.equal(typeof api.resolveBmadConfig,'function');const before=await snapshot(f.root);const r=await api.resolveBmadConfig(f.root);assert.deepEqual(r,JSON.parse(await readFile(new URL('./fixtures/bmad-config-resolved.json',import.meta.url),'utf8')));assert.deepEqual(await snapshot(f.root),before);
});
test('connect honors explicit paths per role and skips resolver when both are explicit',async t=>{
  const f=await fixture(t);await copyFile(path.join(f.root,'planning/epics.md'),path.join(f.root,'planning/epics-old.md'));
  const r=await connect(f,{epics:'planning/epics.md'});assert.equal(r.sources.epics.origin,'explicit');assert.equal(r.sources.sprintStatus.origin,'bmad-config');
  const g=await fixture(t);await connect(g,g.paths,{resolveConfig:()=>{throw new Error('resolver must not run');}});
});
test('connect refuses ambiguous sources including exact canonical filenames',async t=>{
  const f=await fixture(t);await copyFile(path.join(f.root,'planning/epics.md'),path.join(f.root,'planning/epics-old.md'));const before=await snapshot(f.root);
  await assert.rejects(connect(f),e => e instanceof CliError && e.code==='BACKLOG_AMBIGUOUS'&&(e.details.candidates as string[]).join(',')==='planning/epics-old.md,planning/epics.md'&&e.message.includes('--epics'));assert.deepEqual(await snapshot(f.root),before);
});
test('connect never falls back to standard documents after config errors or missing configured folders',async t=>{
  const f=await fixture(t);await put(f.root,'_bmad/custom/config.toml','[modules.bmm]\nplanning_artifacts = "elsewhere"\n');await assert.rejects(connect(f),e => e instanceof CliError && e.code==='BACKLOG_NOT_FOUND');
  await put(f.root,'_bmad/custom/config.toml','invalid');const before=await snapshot(f.root);await assert.rejects(connect(f),e => e instanceof CliError && e.code==='BMAD_CONFIG_ERROR');assert.deepEqual(await snapshot(f.root),before);
});
test('connect rejects unknown or cyclic placeholders and paths outside project',async t=>{
  for(const value of ['{unknown}/planning','{output_folder}/planning','../outside']){
    const f=await fixture(t);await put(f.root,'_bmad/config.toml',`[core]\noutput_folder = "{output_folder}"\n[modules.bmm]\nplanning_artifacts = ${JSON.stringify(value)}\nimplementation_artifacts = "planning"\n`);await assert.rejects(connect(f),e=>e instanceof CliError && ['BMAD_CONFIG_ERROR','UNSAFE_PATH'].includes(e.code));
  }
});
test('connect uses physical deduplication, ignores nested matches and rejects external symlinks',async t=>{
  const f=await fixture(t);await symlink('epics.md',path.join(f.root,'planning/epics-alias.md'));await put(f.root,'planning/nested/epics-second.md','unrelated');assert.equal((await connect(f)).config.bmad.epics,'planning/epics.md');
  const g=await fixture(t),outside=await fixture(t);await symlink(path.join(outside.root,'planning/epics.md'),path.join(g.root,'planning/epics-external.md'));await assert.rejects(connect(g),e => e instanceof CliError && e.code==='UNSAFE_PATH');
});
test('connect keeps saved binding despite changed BMAD config and refuses explicit rebinding',async t=>{
  const f=await fixture(t);await connect(f);await put(f.root,'_bmad/config.toml','invalid after connection');const before=await snapshot(f.root);await connect(f,{}, {resolveConfig:()=>{throw new Error('must not run');}});assert.deepEqual(await snapshot(f.root),before);
  await copyFile(path.join(f.root,'planning/epics.md'),path.join(f.root,'planning/epics-other.md'));await assert.rejects(connect(f,{epics:'planning/epics-other.md'}),e => e instanceof CliError && e.code==='CONFIG_ALREADY_EXISTS');
});
test('connect validates missing tools, malformed backlog, versions and lock without config writes',async t=>{
  const f=await fixture(t);await withProjectLock(f.root,async()=>{await assert.rejects(connect(f,f.paths),e => e instanceof CliError && e.code==='PROJECT_LOCKED');});
  await put(f.root,f.paths.epics,'invalid');await assert.rejects(connect(f,f.paths));
  const g=await fixture(t);await rm(path.join(g.root,g.paths.manifest));await assert.rejects(connect(g),e => e instanceof CliError && e.code==='MISSING_BMAD');
  const h=await fixture(t);await put(h.root,h.paths.manifest,'installation:\n  version: 7.0.0\n');await assert.rejects(connect(h),e => e instanceof CliError && e.code==='UNSUPPORTED_VERSION');
  assert.equal(Object.keys(await snapshot(f.root)).some(p=>p==='.mad-openspec/config.json'),false);
});
test('resolver reports missing or outdated Python and invalid subprocess JSON',async t=>{
  const f=await fixture(t);assert.equal(typeof api.resolveBmadConfig,'function');
  await assert.rejects(api.resolveBmadConfig(f.root,{run:async()=>{throw new Error('ENOENT');}}),e => e instanceof CliError && e.code==='MISSING_PREREQUISITE');
  await assert.rejects(api.resolveBmadConfig(f.root,{run:async()=>({code:0,stdout:'3.10',stderr:''})}),e => e instanceof CliError && e.code==='MISSING_PREREQUISITE');
  let calls=0;await assert.rejects(api.resolveBmadConfig(f.root,{run:async()=>({code:0,stdout:++calls===1?'3.11':'not json',stderr:''})}),e => e instanceof CliError && e.code==='BMAD_CONFIG_ERROR');
});
test('connect CLI reports ambiguity in text and JSON with no saved configuration',async t=>{
  const f=await fixture(t);await copyFile(path.join(f.root,'planning/epics.md'),path.join(f.root,'planning/epics-other.md'));
  const {runCli}=await import('../src/cli.ts');const before=await snapshot(f.root);
  for(const args of [['connect'],['connect','--json']]){let stdout='',stderr='';const code=await runCli(args,{cwd:f.root,openspec:f.adapter,stdout:s=>stdout+=s,stderr:s=>stderr+=s});assert.equal(code,1);
    if(args.includes('--json')){const issue=JSON.parse(stdout).issues[0];assert.equal(issue.code,'BACKLOG_AMBIGUOUS');assert.deepEqual(issue.candidates,['planning/epics-other.md','planning/epics.md']);assert.equal(stderr,'');}else{assert.match(stderr,/BACKLOG_AMBIGUOUS/);assert.match(stderr,/--epics/);}}
  assert.deepEqual(await snapshot(f.root),before);
});
