import type {OpenSpec} from '../../src/types.ts';

// Overrides deliberately allow malformed responses to exercise runtime validation.
type Overrides = Partial<Record<keyof OpenSpec, (id: string) => Promise<unknown>>>;
import {mkdir, writeFile, rename, readFile} from 'node:fs/promises';
import path from 'node:path';

export function fakeOpenSpec(root: string, overrides: Overrides = {}): OpenSpec & {calls: [string, ...string[]][]} {
  const calls: [string, ...string[]][] = [];
  const dir = (id: string) => path.join(root, 'openspec/changes', id);

  const methods: OpenSpec = {
    version: async () => '1.16.0',
    schema: async () => ({name: 'spec-driven', source: 'package', artifacts: ['proposal', 'specs', 'design', 'tasks']}),
    context: async () => ({root: {path: root, source: 'nearest', role: 'openspec_root'}, members: [], status: []}),
    create: async id => {
      await mkdir(dir(id), {recursive: true});
      await writeFile(path.join(dir(id), '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-11-09\n');
      return {id, path: dir(id), metadataPath: path.join(dir(id), '.openspec.yaml'), schema: 'spec-driven'};
    },
    status: async id => ({changeName: id, schemaName: 'spec-driven', changeRoot: dir(id), root: {path: root, source: 'nearest'}, applyRequires: ['tasks'], artifacts: ['proposal', 'specs', 'design', 'tasks'].map(k => ({id: k, status: 'done', requires: []})), artifactPaths: Object.fromEntries(['proposal', 'specs', 'design', 'tasks'].map(k => [k, {existingOutputPaths: [path.join(dir(id), k === 'specs' ? 'specs/invitations/spec.md' : `${k}.md`)]}]))}),
    tasks: async id => {
      const sourcePath = path.join(dir(id), 'tasks.md');
      const text = await readFile(sourcePath, 'utf8');
      const tasks = text.split('\n').flatMap((line, i) => {
        const match = /^- \[([ xX])\] (.+)$/.exec(line);
        return match ? [{id: String(i + 1), description: match[2], done: match[1] !== ' ', sourcePath, line: i + 1}] : [];
      });
      return {tasks, total: tasks.length, completed: tasks.filter(x => x.done).length, remaining: tasks.filter(x => !x.done).length};
    },
    validate: async () => ({valid: true}),
    archive: async id => {
      const archivedAs = `2026-11-09-${id}`;
      const target = path.join(root, 'openspec/changes/archive', archivedAs);
      await mkdir(path.dirname(target), {recursive: true});
      await mkdir(path.join(root, 'openspec/specs/invitations'), {recursive: true});
      await writeFile(path.join(root, 'openspec/specs/invitations/spec.md'), await readFile(path.join(dir(id), 'specs/invitations/spec.md')));
      await rename(dir(id), target);
      return {change: id, archivedAs, path: target, specsUpdated: true};
    }
  };
  const wrapped = Object.fromEntries((Object.keys(methods) as (keyof OpenSpec)[]).map(name => [name, async (...args: string[]) => {
    calls.push([name, ...args]);
    const fn = overrides[name] ?? methods[name];
    return fn(args[0]);
  }]));
  return {...wrapped, calls} as OpenSpec & {calls: [string, ...string[]][]};
}
