import type {SetupOptions, SetupSettings, SetupStep, SetupReport, Installers, Issue} from './types.ts';

interface ConfigMap {[key: string]: unknown}
interface Probe {action: string; actual: string | null; core?: ConfigMap}
import {asError} from './errors.ts';
import {readFile, readdir, lstat, realpath, mkdir, cp, rename, rm, mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {parseDocument} from 'yaml';
import {parse as parseToml} from 'smol-toml';
import {assertWritablePath, readProjectConfig} from './project.ts';
import {atomicWrite, withProjectLock} from './state.ts';
import {CliError, problem} from './errors.ts';
import {cliVersion, checkVersion, installedSkills, readSetupState, setupStatePath} from './version.ts';
import {makeInstallers, bmadBin} from './installers.ts';

export const openSkills=['explore','propose','apply-change','update-change','sync-specs','archive-change'].map(x=>`openspec-${x}`);
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
async function probeBmad(root: string,options: SetupOptions): Promise<Probe>{
  if(!await exists(path.join(root,'_bmad'))){
    const skills=path.join(root,'.agents/skills');
    if(await exists(skills)&&(await readdir(skills)).some(n=>n.startsWith('bmad-')))conflict('Skills BMAD существуют без полной установки _bmad; требуется ручная проверка');
    return {action:'install',actual:null};
  }
  const manifest=await yaml(await assertWritablePath(root,'_bmad/_config/manifest.yaml'));
  if((manifest?.installation as {version?: string} | undefined)?.version!=='6.12.4')conflict('Требуется BMAD 6.12.4; автоматическое обновление запрещено');
  if(!['core','bmm'].every(n=>(manifest.modules as {name: string; version: string}[] | undefined)?.some(m=>m.name===n&&m.version==='6.12.4'))||!(manifest.ides as string[] | undefined)?.includes('codex'))conflict('Неполная установка BMAD core/BMM/Codex');
  for(const file of ['core/module-help.csv','bmm/module-help.csv','scripts/resolve_config.py','scripts/config_utils.py','scripts/render_skill.py','scripts/resolve_customization.py','_config/skill-manifest.csv','_config/files-manifest.csv']){
    const f=await assertWritablePath(root,`_bmad/${file}`);if(!(await lstat(f)).isFile())conflict(`Отсутствует файл BMAD: ${file}`);
  }
  const parseCsv=createRequire(bmadBin())('csv-parse/sync').parse;
  const skills: {name: string; path: string; canonicalId: string}[]=parseCsv(await readFile(path.join(root,'_bmad/_config/skill-manifest.csv'),'utf8'),{columns:true,skip_empty_lines:true});
  if(!skills.length)conflict('Пустой skill manifest BMAD');
  for(const skill of skills){
    if(!/^[a-z][a-z0-9-]*$/.test(skill.name)||typeof skill.path!=='string'||!skill.path.startsWith('_bmad/'))conflict('Неверный skill manifest BMAD');
    const file=`.agents/skills/${skill.canonicalId}/SKILL.md`;
    if(!/^[a-z][a-z0-9-]*$/.test(skill.canonicalId))conflict('Неверный canonical ID skill BMAD');
    const f=await assertWritablePath(root,file);if(!(await lstat(f)).isFile())conflict(`Отсутствует skill BMAD: ${file}`);
  }
  const files: {path: string}[]=parseCsv(await readFile(path.join(root,'_bmad/_config/files-manifest.csv'),'utf8'),{columns:true,skip_empty_lines:true});
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
  return {action:'skip',actual:'6.12.4',core};
}
async function probeOpen(root: string,openRoot: string): Promise<Probe>{
  const dir=await assertWritablePath(root,path.join(openRoot,'openspec'));
  let action='install';
  if(await exists(dir)){
    const config=await yaml(await assertWritablePath(root,path.join(dir,'config.yaml')));
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
    }else if(action==='skip')action='configure';
  }
  return {action,actual:action==='install'?null:'1.16.0'};
}
async function probeMad(root: string): Promise<Probe>{
  for(const name of madSkills){const dir=await assertWritablePath(root,`.agents/skills/${name}`);if(await exists(dir)&&JSON.stringify(await tree(root,dir))!==JSON.stringify(await tree(sources,path.join(sources,name))))conflict(`Skill отличается от поставляемого: ${name}`);}
  return {action:(await Promise.all(madSkills.map(n=>exists(path.join(root,'.agents/skills',n))))).every(Boolean)?'skip':'install',actual:null};
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
  for(const key of (Object.keys(settings) as (keyof SetupSettings)[]))if(options[key]!==undefined){if(typeof options[key]!=='string'||!options[key].trim())throw new CliError('INVALID_ARGUMENTS',`Пустая настройка ${key}`);settings[key]=options[key];}
  const openRoot=await assertWritablePath(root,settings.openspecRoot);
  for(const directory of [path.join(root,'_bmad'),path.join(root,'.agents/skills'),path.join(openRoot,'openspec'),path.join(openRoot,'.agents/skills')])await checkTreePaths(root,directory);
  const checks=[()=>probeBmad(root,options),()=>probeOpen(root,openRoot),()=>probeMad(root)];
  const steps: SetupStep[]=[],issues: Issue[]=[];
  for(let i=0;i<checks.length;i++){
    const id=['bmad','openspec','mad-openspec-skills'][i],expected=['6.12.4','1.16.0',cliVersion][i];
    try{const p=await checks[i]();if(i===0&&p.core)for(const [arg,key]of [['userName','user_name'],['communicationLanguage','communication_language'],['documentOutputLanguage','document_output_language']] as const)settings[arg]=p.core[key] as string;steps.push({id,expected,actual:p.action==='skip' ? expected : p.actual,action:p.action,result:'planned'});}
    catch (caught) {const error = asError(caught);steps.push({id,expected,actual:null,action:'blocked',result:'not-run'});issues.push(problem(error.code==='ENOENT'?new CliError('SETUP_RECOVERY_REQUIRED',`Неполная установка ${id}; проверьте отсутствующие файлы вручную`):error));}
  }
  return {settings,openRoot,steps,issues};
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
      if(p.steps.some(s=>s.action!=='skip'))await installers.prerequisite?.();
      const persist=()=>atomicWrite(root,setupStatePath,`${JSON.stringify({schemaVersion:1,settings:p.settings,steps:p.steps},null,2)}\n`);
      for(const step of p.steps){
        if(step.action==='skip')continue;
        try{
          step.result='running';await persist();
          if(step.id==='bmad')await installers.bmad(root,p.settings);
          else if(step.id==='openspec'){
            const stage=await mkdtemp(path.join(os.tmpdir(),'mad-open-stage-'));
            try{
              await installers.openspec(stage);
              if((await probeOpen(stage,stage)).action!=='skip')throw new CliError('SETUP_POSTCONDITION_FAILED','Installer не подготовил OpenSpec во временном каталоге');
              if(step.action==='install')await publishDirectory(root,path.join(p.openRoot,'openspec'),path.join(stage,'openspec'));
              for(const name of openSkills){const dest=path.join(p.openRoot,'.agents/skills',name);if(!await exists(dest))await publishDirectory(root,dest,path.join(stage,'.agents/skills',name));}
            }finally{await rm(stage,{recursive:true,force:true});}
          }else for(const name of madSkills)await copySkill(root,name);
          const verify=step.id==='bmad'?await probeBmad(root,p.settings):step.id==='openspec'?await probeOpen(root,p.openRoot):await probeMad(root);
          if(verify.action!=='skip')throw new CliError('SETUP_POSTCONDITION_FAILED',`Installer не подготовил компонент ${step.id}`);
          step.actual=step.expected;step.result='completed';await persist();
        }catch (caught) {const error = asError(caught);step.result='failed';report.issues.push(problem(error));report.toolchain='failed';await persist();return report;}
      }
      if (!await exists(path.join(root, setupStatePath))) await persist();
      report.toolchain='ready';report.nextSteps=['Подготовьте epics и sprint status средствами BMAD, затем отдельно выполните mad-openspec connect.'];return report;
    });
  }catch (caught) {const error = asError(caught);report.issues.push(problem(error));return report;}
}
async function publishDirectory(root: string,dest: string,source: string){
  await assertWritablePath(root,dest);await mkdir(path.dirname(dest),{recursive:true});
  const temp=`${dest}.tmp-${randomUUID()}`;
  try{await cp(source,temp,{recursive:true,errorOnExist:true,force:false});await assertWritablePath(root,dest);if(await exists(dest))conflict(`Назначение уже существует: ${dest}`);await rename(temp,dest);}finally{await rm(temp,{recursive:true,force:true});}
}
export function formatSetup(report: SetupReport){return report.steps.map(s=>`${s.id}: ${s.action} (${s.result})\n`).join('')+report.issues.map(i=>`${i.code}: ${i.message}\n`).join('')+report.nextSteps.map(s=>`${s}\n`).join('');}
