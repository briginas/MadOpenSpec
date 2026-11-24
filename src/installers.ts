import type {ProcessRunner, Installers} from './types.ts';
import {createRequire} from 'node:module';
import {mkdtemp, rm, mkdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openSpecBin} from './openspec.ts';
import {CliError} from './errors.ts';
import {execute} from './process.ts';
export {execute} from './process.ts';

export const bmadBin = () => createRequire(import.meta.url).resolve('bmad-method');
export function makeInstallers({run=execute,log=()=>{}}: {run?: ProcessRunner; log?: (text: string) => void}={}): Installers {
  async function invoke(file: string,args: string[],cwd: string) {
    const temporary=await mkdtemp(path.join(os.tmpdir(),'mad-installer-'));
    try {
      const env={...process.env,HOME:temporary,USERPROFILE:temporary,XDG_CONFIG_HOME:path.join(temporary,'config'),XDG_DATA_HOME:path.join(temporary,'data'),XDG_CACHE_HOME:path.join(temporary,'cache'),CODEX_HOME:path.join(temporary,'codex'),APPDATA:path.join(temporary,'config'),LOCALAPPDATA:path.join(temporary,'data'),npm_config_cache:path.join(temporary,'npm-cache'),OPENSPEC_TELEMETRY:'0',CI:'1',NO_COLOR:'1'};
      const result=await run(file,args,{cwd,env});
      if(result.stdout) log(result.stdout);if(result.stderr) log(result.stderr);
      if(result.code!==0) throw new CliError('INSTALLER_FAILED',`Installer завершился с кодом ${result.code}`,{exitCode:result.code});
    } finally {await rm(temporary,{recursive:true,force:true});}
  }
  return {
    async prerequisite(){
      if(Number(process.versions.node.split('.')[0])<22 || Number(process.versions.node.split('.')[0])===22 && Number(process.versions.node.split('.')[1])<20) throw new CliError('MISSING_PREREQUISITE','Требуется Node.js >=22.20');
      const pkg=JSON.parse(await readFile(path.join(path.dirname(bmadBin()),'../../package.json'),'utf8'));
      if(pkg.version!=='6.12.4') throw new CliError('UNSUPPORTED_VERSION','Требуется поставляемый bmad-method 6.12.4');
      const npm=await run(process.platform==='win32'?'npm.cmd':'npm',['--version'],{cwd:process.cwd(),env:process.env});
      if(npm.code!==0) throw new CliError('MISSING_PREREQUISITE','Требуется npm');
    },
    bmad:async(root,s)=>invoke(process.execPath,[bmadBin(),'install','--directory',root,'--modules','bmm','--tools','codex','--user-name',s.userName,'--communication-language',s.communicationLanguage,'--document-output-language',s.documentOutputLanguage,'--output-folder','_bmad-output','--no-shims','--yes'],root),
    openspec:async root=>{await mkdir(root,{recursive:true});await invoke(process.execPath,[openSpecBin(),'init',root,'--tools','codex','--scope','project','--profile','core','--language','en','--no-animation'],root);}
  };
}
