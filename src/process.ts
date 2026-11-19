import type {ProcessOptions, ProcessResult} from './types.ts';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {CliError} from './errors.ts';

export function execute(file: string, args: string[], {cwd, env=process.env, timeout=120000}: ProcessOptions={}): Promise<ProcessResult> {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,env,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',size=0,timedOut=false,overflow=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
    for(const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']] as const) stream.on('data',chunk=>{
      size+=chunk.length;if(size>16*1024*1024){overflow=true;child.kill('SIGKILL');return;}
      if(key==='stdout') stdout+=chunk;else stderr+=chunk;
    });
    child.on('error',error=>{clearTimeout(timer);reject(new CliError('PROCESS_FAILED',`Не удалось запустить ${path.basename(file)}: ${error.message}`));});
    child.on('close',code=>{clearTimeout(timer);if(timedOut||overflow) reject(new CliError('PROCESS_FAILED',timedOut?'Превышено время выполнения subprocess':'Превышен размер вывода subprocess'));else resolve({code,stdout,stderr});});
  });
}
