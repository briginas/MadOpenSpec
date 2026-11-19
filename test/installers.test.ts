import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {makeInstallers,execute,bmadBin} from '../src/installers.ts';
test('installer adapters use pinned package, stable options and isolated user config',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'mad-adapter-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls: [string, string[], import('../src/types.ts').ProcessOptions & {env: NodeJS.ProcessEnv}][]=[],logs: string[]=[];const i=makeInstallers({run:async(...args)=>{calls.push(args as [string, string[], import('../src/types.ts').ProcessOptions & {env: NodeJS.ProcessEnv}]);return {code:0,stdout:'installer log',stderr:''};},log:text=>logs.push(text)});
  await i.bmad(root,{userName:'Developer',communicationLanguage:'Russian',documentOutputLanguage:'Russian'});await i.openspec(root);
  assert.equal(JSON.parse(await readFile(path.join(path.dirname(bmadBin()),'../../package.json'),'utf8')).version,'6.12.4');
  assert.deepEqual(calls[0][1].slice(1),['install','--directory',root,'--modules','bmm','--tools','codex','--user-name','Developer','--communication-language','Russian','--document-output-language','Russian','--output-folder','_bmad-output','--no-shims','--yes']);
  for(const [,args,{env,cwd}]of calls){assert.equal(cwd,root);assert.notEqual(env.HOME,os.homedir());assert.notEqual(env.CODEX_HOME,process.env.CODEX_HOME);assert.equal(args.includes('latest'),false);}
  assert.equal(logs.length,2);
});
test('process runner closes stdin and reports timeout and nonzero exit',async()=>{
  const r=await execute(process.execPath,['-e','process.stdin.on("end",()=>process.exit(7));process.stdin.resume()']);assert.equal(r.code,7);
  await assert.rejects(execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:25}),/время/);
});
