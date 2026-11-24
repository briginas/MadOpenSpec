import type {BmadProfile, SetupOptions, SetupSettings, SetupStep, SetupReport, Installers, Issue} from './types.ts';

interface ConfigMap {[key: string]: unknown}
interface Probe {action: string; actual: string | null; core?: ConfigMap; profile?: BmadProfile; migration?: Awaited<ReturnType<typeof planBmadMigration>>}
import {asError} from './errors.ts';
import {readFile, readdir, lstat, realpath, mkdir, cp, rename, rm, mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {parseDocument} from 'yaml';
import {parse as parseToml} from 'smol-toml';
import {assertWritablePath, readProjectConfig} from './project.ts';
import {atomicWrite, withProjectLock} from './state.ts';
import {CliError, problem} from './errors.ts';
import {cliVersion, openSpecVersion, checkVersion, installedSkills, readSetupState, setupStatePath} from './version.ts';
import {makeInstallers} from './installers.ts';
import {matchesPlanningProfile, planningSkillIds, preparePlanningCatalogs, readBmadCatalog} from './bmad-profile.ts';
import {migrateBmad, migrationBackup, planBmadMigration} from './bmad-migration.ts';
import {planPlanningRule} from './planning-rule.ts';
import {openSkills, openSkillContent, codexTargetUpdate, targetMarker} from './openspec-skills.ts';

export {openSkills};
export const madSkills=['mad-openspec-guide','mad-openspec-prepare','mad-openspec-apply','mad-openspec-close'];
export const sources=fileURLToPath(new URL('../skills/',import.meta.url));
export async function exists(file: string){try{await lstat(file);return true;}catch (caught) {const e = asError(caught);if(e.code==='ENOENT')return false;throw e;}}
async function yaml(file: string): Promise<ConfigMap>{const doc=parseDocument(await readFile(file,'utf8'));if(doc.errors.length)throw new CliError('SETUP_CONFLICT',`Неверный YAML: ${file}`);return doc.toJS();}
const conflict: (message: string) => never = message=>{throw new CliError('SETUP_CONFLICT',message);};
export async function readBmadConfig(root: string): Promise<ConfigMap>{
  let result: ConfigMap={};
  const object=(x: unknown): x is ConfigMap=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const merge=(a: ConfigMap,b: ConfigMap): ConfigMap=>{for(const [k,v] of Object.entries(b))a[k]=object(v)?merge(object(a[k])?a[k]:{},v):v;return a;};
  for(const file of ['config.toml','config.user.toml','custom/config.toml','custom/config.user.toml']){
    const target=await assertWritablePath(root,`_bmad/${file}`);
    if(!await exists(target)){if(file==='config.toml')conflict('Отсутствует _bmad/config.toml');continue;}
    try{result=merge(result,parseToml(await readFile(target,'utf8')));}catch (caught) {const e = asError(caught);throw new CliError('SETUP_CONFLICT',`Неверный BMAD config ${file}: ${e.message}`);}
  }
  return result;
}
async function tree(root: string,directory: string): Promise<Record<string, string>>{
  const target=await assertWritablePath(root,directory),s=await lstat(target);
  if(s.isSymbolicLink()||!s.isDirectory())conflict(`Ожидался обычный каталог: ${directory}`);
  const result: Record<string, string>={};
  for(const name of (await readdir(target)).sort()){
    const f=path.join(target,name),st=await lstat(f);await assertWritablePath(root,f);
    if(st.isSymbolicLink())conflict(`Symlink в устанавливаемом skill: ${f}`);
    if(st.isDirectory()){for(const [p,v]of Object.entries(await tree(root,f)))result[`${name}/${p}`]=v;}
    else if(st.isFile())result[name]=(await readFile(f)).toString('base64');
    else conflict(`Неподдерживаемый файл skill: ${f}`);
  }
  return result;
}
export async function copySkill(root: string,name: string,sourceRoot=sources){
  const target=await assertWritablePath(root,`.agents/skills/${name}`),source=path.join(sourceRoot,name);
  if(await exists(target)){
    if(JSON.stringify(await tree(root,target))!==JSON.stringify(await tree(sourceRoot,source)))conflict(`Skill отличается от поставляемого: ${name}`);
    return;
  }
  await mkdir(path.dirname(target),{recursive:true});
  const temp=path.join(path.dirname(target),`.${name}.tmp-${randomUUID()}`);
  try{await cp(source,temp,{recursive:true,errorOnExist:true,force:false});await assertWritablePath(root,target);if(await exists(target))conflict(`Skill появился во время установки: ${name}`);await rename(temp,target);}finally{await rm(temp,{recursive:true,force:true});}
}
async function probeBmad(root: string,options: SetupOptions, allowMigration = false): Promise<Probe>{
  if(!await exists(path.join(root,'_bmad'))){
    const skills=path.join(root,'.agents/skills');
    if(await exists(skills)&&(await readdir(skills)).some(n=>n.startsWith('bmad-')))conflict('Skills BMAD существуют без полной установки _bmad; требуется ручная проверка');
    return {action:'install',actual:null,profile:options.bmadProfile ?? 'planning'};
  }
  const manifest=await yaml(await assertWritablePath(root,'_bmad/_config/manifest.yaml'));
  if((manifest?.installation as {version?: string} | undefined)?.version!=='6.12.4')conflict('Требуется BMAD 6.12.4; автоматическое обновление запрещено');
  if(!['core','bmm'].every(n=>(manifest.modules as {name: string; version: string}[] | undefined)?.some(m=>m.name===n&&m.version==='6.12.4'))||!(manifest.ides as string[] | undefined)?.includes('codex'))conflict('Неполная установка BMAD core/BMM/Codex');
  for(const file of ['core/module-help.csv','bmm/module-help.csv','scripts/resolve_config.py','scripts/config_utils.py','scripts/render_skill.py','scripts/resolve_customization.py','_config/skill-manifest.csv','_config/files-manifest.csv']){
    const f=await assertWritablePath(root,`_bmad/${file}`);if(!(await lstat(f)).isFile())conflict(`Отсутствует файл BMAD: ${file}`);
  }
  const skills = await readBmadCatalog(path.join(root,'_bmad/_config/skill-manifest.csv'));
  const profile = matchesPlanningProfile(skills.map(skill => skill.canonicalId)) ? 'planning' : 'full';
  const migrate = allowMigration && profile === 'full' && options.bmadProfile === 'planning';
  if (!migrate && options.bmadProfile && options.bmadProfile !== profile) {
    conflict(`Состав установки BMAD отличается от профиля ${options.bmadProfile}; проверьте _bmad/_config/skill-manifest.csv`);
  }
  if (profile === 'planning') {
    const help = await readBmadCatalog(await assertWritablePath(root, '_bmad/_config/bmad-help.csv'));
    const listed = help.filter(row => row.skill !== '_meta').map(row => row.skill);
    if (!matchesPlanningProfile([...new Set(listed)])) conflict('Каталог bmad-help.csv не соответствует профилю planning');
  }
  if(!skills.length)conflict('Пустой skill manifest BMAD');
  for(const skill of skills){
    if(!/^[a-z][a-z0-9-]*$/.test(skill.name)||typeof skill.path!=='string'||!skill.path.startsWith('_bmad/'))conflict('Неверный skill manifest BMAD');
    const file=`.agents/skills/${skill.canonicalId}/SKILL.md`;
    if(!/^[a-z][a-z0-9-]*$/.test(skill.canonicalId))conflict('Неверный canonical ID skill BMAD');
    const f=await assertWritablePath(root,file);if(!(await lstat(f)).isFile())conflict(`Отсутствует skill BMAD: ${file}`);
  }
  const files = await readBmadCatalog(path.join(root,'_bmad/_config/files-manifest.csv'));
  if(!files.length)conflict('Пустой files manifest BMAD');
  for(const file of files){
    if(typeof file.path!=='string'||!file.path||path.isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..'))conflict('Неверный files manifest BMAD');
    const source=path.join('_bmad',file.path);
    const skill=skills.find(s=>source.startsWith(`${path.dirname(path.normalize(s.path))}${path.sep}`));
    const relative=skill?path.relative(path.dirname(skill.path),source):file.path;
    const ignored=relative.split(/[\\/]/).some(name=>['.DS_Store','Thumbs.db','desktop.ini','__pycache__'].includes(name)||['~','.swp','.swo','.bak','.pyc','.pyo'].some(s=>name.endsWith(s))||name.startsWith('.')&&name!=='.gitkeep');
    if(ignored)continue;
    const destination=skill?path.join('.agents/skills',skill.canonicalId,relative):source;
    const f=await assertWritablePath(root,destination);
    if(!(await lstat(f)).isFile())conflict(`Отсутствует файл BMAD: ${destination}`);
  }
  const config=await readBmadConfig(root),core=config.core as ConfigMap | undefined;
  for(const [arg,key]of [['userName','user_name'],['communicationLanguage','communication_language'],['documentOutputLanguage','document_output_language']] as const){
    if(typeof core?.[key]!=='string'||!core[key])conflict(`Неверная настройка BMAD: ${key}`);
    if(options[arg]!==undefined&&core[key]!==options[arg])conflict(`Настройка ${arg} отличается от существующей`);
  }
  if (migrate) {
    if ((manifest.modules as unknown[]).length !== 2 || (manifest.ides as unknown[]).length !== 1) {
      conflict('Миграция поддерживает установку BMAD core/BMM для Codex; каталоги также используются другими модулями или IDE');
    }
    return {action:'migrate', actual:'6.12.4', core, profile:'planning', migration:await planBmadMigration(root)};
  }
  return {action:'skip',actual:'6.12.4',core,profile};
}
async function probeOpen(root: string,openRoot: string): Promise<Probe>{
  const dir=await assertWritablePath(root,path.join(openRoot,'openspec'));
  let action='install';
  if(await exists(dir)){
    const config=await yaml(await assertWritablePath(root,path.join(dir,'config.yaml')));
    if(config?.skillsScope==='global')conflict('Для MadOpenSpec требуются skills уровня проекта.');
    if(config?.store!==undefined||(config?.schema??'spec-driven')!=='spec-driven')conflict('Требуется локальная spec-driven schema без store');
    action='skip';
  }
  for(const base of [path.join(openRoot,'openspec/schemas/spec-driven'),path.join(process.env.XDG_DATA_HOME??path.join(os.homedir(),'.local/share'),'openspec/schemas/spec-driven')])if(await exists(base))conflict('Переопределение spec-driven schema не поддерживается');
  for(const name of openSkills){
    const dir=await assertWritablePath(root,path.join(openRoot,'.agents/skills',name));
    if(await exists(dir)){
      if(action==='install')conflict('Skills OpenSpec существуют без OpenSpec-root; требуется ручная проверка');
      if(!await exists(path.join(dir,'SKILL.md')))conflict(`Неполный skill OpenSpec: ${name}`);
      await tree(root,dir);
      if(await readFile(path.join(dir,'SKILL.md'),'utf8') !== await openSkillContent(name)) {
        conflict(`Версия или содержимое ${dir}/SKILL.md отличается от OpenSpec ${openSpecVersion}. Для управляемого проекта выполните mad-openspec update.`);
      }
    }else if(action==='skip')action='configure';
  }
  if (await exists(openRoot)) {
    const marker = await codexTargetUpdate(openRoot);
    if (action === 'skip' && marker !== null) action = 'configure';
  }
  return {action,actual:action==='install'?null:openSpecVersion};
}
async function probeMad(root: string): Promise<Probe>{
  for(const name of madSkills){const dir=await assertWritablePath(root,`.agents/skills/${name}`);if(await exists(dir)&&JSON.stringify(await tree(root,dir))!==JSON.stringify(await tree(sources,path.join(sources,name))))conflict(`Skill отличается от поставляемого: ${name}`);}
  const ruleWrites = await planPlanningRule(root, 'SETUP_CONFLICT');
  const allInstalled = (await Promise.all(madSkills.map(n=>exists(path.join(root,'.agents/skills',n))))).every(Boolean);
  return {action: allInstalled ? (ruleWrites.size ? 'configure' : 'skip') : 'install', actual: null};
}
async function plan(root: string,options: SetupOptions){
  for(const file of ['_bmad','_bmad-output','.gitignore','.agents/skills','.mad-openspec/setup-state.json',options.openspecRoot??'.'])await assertWritablePath(root,file);
  // Setup can repair tool files even when the separate backlog configuration is invalid.
  let connection;
  try {connection = await readProjectConfig(root);}
  catch (error) {
    if (!['PROJECT_NOT_INITIALIZED', 'INVALID_CONFIG'].includes(String(asError(error).code))) throw error;
  }
  if (connection) checkVersion(connection.madOpenSpecVersion ?? null);
  const state = await readSetupState(root);
  const previous = installedSkills(state);
  if (previous) checkVersion(previous.actual ?? previous.expected);
  const settings: SetupSettings={userName:'Developer',communicationLanguage:'Russian',documentOutputLanguage:'Russian',openspecRoot:'.',...state?.settings};
  if(state&&options.openspecRoot!==undefined){
    const previous=await assertWritablePath(root,settings.openspecRoot),requested=await assertWritablePath(root,options.openspecRoot);
    const canonical=async (p: string)=>await exists(p)?realpath(p):p;
    if(await canonical(previous)!==await canonical(requested))conflict('openspec-root отличается от сохранённого setup; автоматическая смена назначения запрещена');
  }
  if (await exists(await assertWritablePath(root, migrationBackup))) {
    throw new CliError('SETUP_RECOVERY_REQUIRED', `Обнаружена незавершённая миграция BMAD; проверьте резервные файлы в ${migrationBackup}`);
  }
  const allowMigration = options.bmadProfile === 'planning' && settings.bmadProfile !== 'planning';
  if (!allowMigration && settings.bmadProfile && options.bmadProfile && settings.bmadProfile !== options.bmadProfile) {
    conflict(`Для проекта сохранён профиль BMAD ${settings.bmadProfile}, запрошен ${options.bmadProfile}`);
  }
  for(const key of ['openspecRoot','userName','communicationLanguage','documentOutputLanguage'] as const)if(options[key]!==undefined){if(typeof options[key]!=='string'||!options[key].trim())throw new CliError('INVALID_ARGUMENTS',`Пустая настройка ${key}`);settings[key]=options[key];}
  const openRoot=await assertWritablePath(root,settings.openspecRoot);
  for(const directory of [path.join(root,'_bmad'),path.join(root,'.agents/skills'),path.join(openRoot,'openspec'),path.join(openRoot,'.agents/skills')])await checkTreePaths(root,directory);
  const checks=[()=>probeBmad(root,{...options,bmadProfile: options.bmadProfile ?? settings.bmadProfile}, allowMigration),()=>probeOpen(root,openRoot),()=>probeMad(root)];
  let migration: Probe['migration'];
  const steps: SetupStep[]=[],issues: Issue[]=[];
  for(let i=0;i<checks.length;i++){
    const id=['bmad','openspec','mad-openspec-skills'][i],expected=['6.12.4',openSpecVersion,cliVersion][i];
    try {
      const probe = await checks[i]();
      if (probe.migration) migration = probe.migration;
      if (probe.profile) settings.bmadProfile = probe.profile;
      if (probe.core) {
        settings.userName = probe.core.user_name as string;
        settings.communicationLanguage = probe.core.communication_language as string;
        settings.documentOutputLanguage = probe.core.document_output_language as string;
      }
      steps.push({id, expected, profile: probe.profile, removeSkills: probe.migration?.removed.map(row => row.canonicalId), actual: probe.action === 'skip' ? expected : probe.actual,
        action: probe.action, result: 'planned'});
    }
    catch (caught) {const error = asError(caught);steps.push({id,expected,actual:null,action:'blocked',result:'not-run'});issues.push(problem(error.code==='ENOENT'?new CliError('SETUP_RECOVERY_REQUIRED',`Неполная установка ${id}; проверьте отсутствующие файлы вручную`):error));}
  }
  return {settings,openRoot,steps,issues,migration};
}
async function checkTreePaths(root: string,directory: string): Promise<void>{
  await assertWritablePath(root,directory);
  if(!await exists(directory))return;
  const st=await lstat(directory);
  if(st.isSymbolicLink())conflict(`Symlink в назначении установки: ${directory}`);
  if(st.isDirectory())for(const name of await readdir(directory))await checkTreePaths(root,path.join(directory,name));
}
export async function setupProject(root: string,options: SetupOptions={},deps: {installers?: Installers; log?: (text: string) => void}={}){
  root=await realpath(root);
  const report: SetupReport={schemaVersion:1,dryRun:options.dryRun===true,steps:[],toolchain:'blocked',issues:[],nextSteps:[]};
  const installers=deps.installers??makeInstallers({log:deps.log});
  try{
    let p=await plan(root,options);report.steps=p.steps;report.issues=p.issues;if(p.issues.length)return report;
    if(options.dryRun){report.toolchain=p.steps.every(s=>s.action==='skip')?'ready':'planned';return report;}
    return await withProjectLock(root,async()=>{
      p=await plan(root,options);report.steps=p.steps;report.issues=p.issues;if(p.issues.length)return report;
      for(const s of p.steps)s.result=s.action==='skip'?'skipped':'not-run';
      if(p.steps.some(s=>s.action!=='skip' && s.action!=='migrate'))await installers.prerequisite?.();
      const persist=()=>atomicWrite(root,setupStatePath,`${JSON.stringify({schemaVersion:1,settings:p.settings,steps:p.steps},null,2)}\n`);
      for(const step of p.steps){
        if(step.action==='skip')continue;
        try{
          if (step.action === 'migrate' && p.migration) {
            await migrateBmad(root, p.migration, async () => {
              const result = await probeBmad(root, p.settings);
              if (result.action !== 'skip') throw new CliError('SETUP_POSTCONDITION_FAILED','Не удалось подтвердить миграцию BMAD');
              step.result = 'completed';
              await persist();
            });
            continue;
          }
          step.result='running';await persist();
          if(step.id==='bmad'){
            if (p.settings.bmadProfile === 'planning') await installPlanningBmad(root, p.settings, installers);
            else await installers.bmad(root, p.settings);
          }
          else if(step.id==='openspec'){
            const stage=await mkdtemp(path.join(os.tmpdir(),'mad-open-stage-'));
            try{
              await installers.openspec(stage);
              if((await probeOpen(stage,stage)).action!=='skip')throw new CliError('SETUP_POSTCONDITION_FAILED','Installer не подготовил OpenSpec во временном каталоге');
              if(step.action==='install')await publishDirectory(root,path.join(p.openRoot,'openspec'),path.join(stage,'openspec'));
              for(const name of openSkills){const dest=path.join(p.openRoot,'.agents/skills',name);if(!await exists(dest))await publishDirectory(root,dest,path.join(stage,'.agents/skills',name));}
              const marker = await codexTargetUpdate(p.openRoot);
              if (marker !== null) await atomicWrite(root,path.join(p.openRoot,targetMarker),marker);
            }finally{await rm(stage,{recursive:true,force:true});}
          }else {
            const ruleWrites = await planPlanningRule(root, 'SETUP_CONFLICT');
            for(const name of madSkills)await copySkill(root,name);
            for (const [file, text] of ruleWrites) await atomicWrite(root, file, text);
          }
          const verify=step.id==='bmad'?await probeBmad(root,p.settings):step.id==='openspec'?await probeOpen(root,p.openRoot):await probeMad(root);
          if(verify.action!=='skip')throw new CliError('SETUP_POSTCONDITION_FAILED',`Installer не подготовил компонент ${step.id}`);
          step.actual=step.expected;step.result='completed';await persist();
        }catch (caught) {const error = asError(caught);step.result='failed';report.issues.push(problem(error));report.toolchain='failed';if(step.action!=='migrate')await persist();return report;}
      }
      if (!await exists(path.join(root, setupStatePath))) await persist();
      report.toolchain='ready';report.nextSteps=['Подготовьте epics и sprint status средствами BMAD, затем отдельно выполните mad-openspec connect.'];return report;
    });
  }catch (caught) {const error = asError(caught);report.issues.push(problem(error));return report;}
}
async function installPlanningBmad(root: string, settings: SetupSettings, installers: Installers) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mad-bmad-stage-'));
  try {
    const stage = path.join(temporary, path.basename(root));
    await mkdir(stage);
    await installers.bmad(stage, settings);
    await preparePlanningCatalogs(stage);
    await probeBmad(stage, settings);
    const output = await assertWritablePath(root, '_bmad-output');
    await mkdir(output, {recursive: true});
    for (const id of planningSkillIds) {
      const skill = path.join('.agents', 'skills', id);
      await publishDirectory(root, path.join(root, skill), path.join(stage, skill));
    }
    await publishDirectory(root, path.join(root, '_bmad'), path.join(stage, '_bmad'));
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

async function publishDirectory(root: string,dest: string,source: string){
  await assertWritablePath(root,dest);await mkdir(path.dirname(dest),{recursive:true});
  const temp=`${dest}.tmp-${randomUUID()}`;
  try{await cp(source,temp,{recursive:true,errorOnExist:true,force:false});await assertWritablePath(root,dest);if(await exists(dest))conflict(`Назначение уже существует: ${dest}`);await rename(temp,dest);}finally{await rm(temp,{recursive:true,force:true});}
}
export function formatSetup(report: SetupReport){return report.steps.map(s=>`${s.id}${s.profile ? ' [' + s.profile + ']' : ''}: ${s.action} (${s.result})\n${s.removeSkills ? '  Удаляемые скилы: ' + s.removeSkills.join(', ') + '\n' : ''}`).join('')+report.issues.map(i=>`${i.code}: ${i.message}\n`).join('')+report.nextSteps.map(s=>`${s}\n`).join('');}
