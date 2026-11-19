import type {OpenSpec, Project} from './types.ts';
import {changeDirectory, verifyMarker} from './create.ts';
import {CliError} from './errors.ts';
import {readRegistry} from './state.ts';

export async function storyProgress(project: Project, storyId: string, openspec: OpenSpec): Promise<string> {
  const registry = await readRegistry(project.root);
  const link = registry.stories[storyId];
  if (!link) throw new CliError('UNLINKED_STORY', `История ${storyId} не связана с изменением OpenSpec`);
  if (link.phase !== 'active') throw new CliError('CHANGE_NOT_ACTIVE', `Изменение ${link.changeId} находится в фазе ${link.phase}`);
  await verifyMarker(project, storyId, link, changeDirectory(project, link.changeId));
  const {tasks, completed, total} = await openspec.tasks(link.changeId);
  if (!total) throw new CliError('EMPTY_TASKS', 'Список задач пуст');

  const current = tasks.findIndex(task => !task.done);
  const rows = tasks.map((task, index) => {
    const marker = task.done ? '✓' : index === current ? '→' : '○';
    return `${marker} ${task.description}`;
  });
  return `Прогресс по истории ${storyId} · готово ${completed} из ${total}\n\n${rows.join('\n')}\n`;
}
