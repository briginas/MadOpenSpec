import type {BmadConfig, OpenSpec, ProcessRunner, ProjectPaths, StatusSource} from './types.ts';
import {asError} from './errors.ts';
import {readFile,realpath,readdir,stat,lstat} from 'node:fs/promises';
import path from 'node:path';
import {parseDocument} from 'yaml';
import {CliError} from './errors.ts';
import {assertWritablePath,loadConfig,initProject} from './project.ts';
import {makeOpenSpec} from './openspec.ts';
import {checkSetupVersion} from './version.ts';
import {execute} from './process.ts';

async function checkManifest(root: string,manifest: string){
  const file=await assertWritablePath(root,manifest);
  let text;try{text=await readFile(file,'utf8');}catch (caught) {const error = asError(caught);if(error.code==='ENOENT')throw new CliError('MISSING_BMAD','BMAD не установлен или manifest отсутствует; сначала подготовьте инструменты',{path:manifest});throw error;}
  const doc=parseDocument(text);
  if(doc.errors.length)throw new CliError('INVALID_BMAD_MANIFEST','Неверный YAML manifest BMAD');
  if(doc.getIn(['installation','version'])!=='6.12.4')throw new CliError('UNSUPPORTED_VERSION','Требуется BMAD v6.12.4');
}
export async function resolveBmadConfig(root: string,{run=execute,python='python3'}: {run?: ProcessRunner; python?: string}={}): Promise<BmadConfig>{
  let version;
  try{version=await run(python,['-I','-c','import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],{cwd:root,env:process.env,timeout:15000});}
  catch{throw new CliError('MISSING_PREREQUISITE','Для автопоиска требуется Python 3.11+; установите его или задайте пути epics и sprint status явно');}
  const match=/^(\d+)\.(\d+)\s*$/.exec(version.stdout??'');
  if(version.code!==0||!match||Number(match[1])!==3||Number(match[2])<11)throw new CliError('MISSING_PREREQUISITE','Для автопоиска требуется Python 3.11+; можно задать пути документов явно');
  for(const file of ['scripts/resolve_config.py','scripts/config_utils.py','config.toml','config.user.toml','custom/config.toml','custom/config.user.toml'])await assertWritablePath(root,`_bmad/${file}`);
  const script=await assertWritablePath(root,'_bmad/scripts/resolve_config.py');
  let result;
  try{result=await run(python,['-B','-s',script,'--project-root',root],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONPATH:''},timeout:15000});}
  catch (caught) {const error = asError(caught);throw new CliError('BMAD_CONFIG_ERROR',`Не удалось выполнить BMAD resolver: ${error.message}`);}
  if(result.code!==0)throw new CliError('BMAD_CONFIG_ERROR',`BMAD resolver: ${(result.stderr||result.stdout||'ошибка конфигурации').trim()}`);
  try{const config=JSON.parse(result.stdout);if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Ожидался JSON object');return config;}
  catch{throw new CliError('BMAD_CONFIG_ERROR','BMAD resolver вернул неверный JSON');}
}
function expandDirectory(root: string,value: unknown,config: BmadConfig){
  const expand=(text: unknown,seen: string[]=[]): string=>{
    if(typeof text!=='string'||!text.trim())throw new CliError('BMAD_CONFIG_ERROR','Нужный каталог не задан в BMAD config');
    return text.replace(/\{([^{}]+)\}/g,(_,key)=>{
      if(seen.includes(key))throw new CliError('BMAD_CONFIG_ERROR',`Циклический placeholder BMAD: ${key}`);
      if(key==='project-root')return root;
      if(key==='output_folder')return expand(config.core?.output_folder,[...seen,key]);
      throw new CliError('BMAD_CONFIG_ERROR',`Неизвестный placeholder BMAD: ${key}`);
    });
  };
  const result=expand(value);if(/[{}]/.test(result))throw new CliError('BMAD_CONFIG_ERROR','Неразрешённый placeholder BMAD');return path.resolve(root,result);
}
async function candidates(root: string,directory: string,pattern: RegExp){
  await assertWritablePath(root,directory);
  let names;try{names=(await readdir(directory)).filter(n=>pattern.test(n)).sort();}catch (caught) {const e = asError(caught);if(e.code==='ENOENT')return [];throw e;}
  const found=new Map();
  for(const name of names){
    const file=await assertWritablePath(root,path.join(directory,name));
    if(!(await stat(file)).isFile())continue;
    const physical=await realpath(file);
    // Prefer the physical filename for aliases, then sort for deterministic diagnostics.
    if(!found.has(physical))found.set(physical,path.relative(root,physical));
  }
  return [...found.values()].sort();
}
export async function findBmadDocument(root: string, config: BmadConfig, role: 'epics' | 'sprintStatus'): Promise<StatusSource> {
  const key = role === 'epics' ? 'planning_artifacts' : 'implementation_artifacts';
  const directory = expandDirectory(root, config.modules?.bmm?.[key], config);
  const matches = await candidates(root, directory, role === 'epics' ? /^epics.*\.md$/ : /^sprint-status.*\.yaml$/);
  if (matches.length > 1) return {state: 'ambiguous', path: null, candidates: matches};
  if (!matches.length) return {state: 'missing', path: path.relative(root, directory) || '.'};
  return {state: 'present', path: matches[0]};
}
export async function connectProject(root: string,options: Partial<ProjectPaths>={},deps: {openspec?: OpenSpec; resolveConfig?: (root: string) => Promise<BmadConfig>}={}){
  root=await realpath(root);
  await checkSetupVersion(root);
  let saved;
  try{saved=await loadConfig(root);}catch (caught) {const error = asError(caught);if(error.code!=='PROJECT_NOT_INITIALIZED')throw error;}
  const values={manifest:saved?.bmad.manifest??'_bmad/_config/manifest.yaml',openspecRoot:saved?.openspec.root??'.',epics:saved?.bmad.epics,sprintStatus:saved?.bmad.sprintStatus};
  const sources: Partial<Record<keyof ProjectPaths, {path: string; origin: string}>>={};
  for(const key of (Object.keys(values) as (keyof ProjectPaths)[])){
    if(options[key]!==undefined){if(typeof options[key]!=='string'||!options[key].trim())throw new CliError('INVALID_ARGUMENTS',`Пустой путь ${key}`);values[key]=options[key];}
    if(values[key]!==undefined)sources[key]={path:values[key],origin:options[key]!==undefined?'explicit':saved?'saved':'default'};
  }
  await checkManifest(root,values.manifest);
  const missing=[];
  if(!values.epics||!values.sprintStatus){
    const config=await(deps.resolveConfig??resolveBmadConfig)(root);
    for(const [role,flag]of [['epics','--epics'],['sprintStatus','--sprint-status']] as const){
      if(values[role])continue;
      const source=await findBmadDocument(root,config,role);
      if(source.state==='ambiguous')throw new CliError('BACKLOG_AMBIGUOUS',`Найдено несколько документов ${role}; укажите ${flag}: ${source.candidates!.join(', ')}`,{role,candidates:source.candidates,option:flag});
      if(source.state==='missing'){missing.push({role,directory:source.path,option:flag});continue;}
      values[role]=source.path!;sources[role]={path:source.path!,origin:'bmad-config'};
    }
  }
  if(missing.length)throw new CliError('BACKLOG_NOT_FOUND',`Не найдены документы: ${missing.map(x=>`${x.role} (${x.directory}); укажите ${x.option}`).join('; ')}`,{missing});
  const openspec=deps.openspec??makeOpenSpec({cwd:await assertWritablePath(root,values.openspecRoot)});
  const project=await initProject(root,values as ProjectPaths,openspec);
  for(const [key,value]of Object.entries(sources))value.path=key==='openspecRoot'?project.config.openspec.root:project.config.bmad[key as 'epics' | 'sprintStatus' | 'manifest'];
  return {...project,sources: sources as Record<keyof ProjectPaths, {path: string; origin: string}>};
}
