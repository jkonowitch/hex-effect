import { Effect, Random } from 'effect';
import { Task, TaskAddedEvent, TaskCompletedEvent, TaskId } from './model.js';
import type { Project } from '../project/model.js';

const makeWithUUID = (args: Omit<Parameters<(typeof Task)['make']>[0], 'id'>) =>
  Effect.serviceConstants(Random.Random).next.pipe(
    Effect.map((rand) => Task.make({ ...args, id: TaskId.make(`${rand}`) }))
  );

export const addTaskToProject = (
  project: typeof Project.Type,
  description: string
): Effect.Effect<
  [typeof Task.Type, ReturnType<typeof TaskAddedEvent.make>],
  never,
  Random.Random
> =>
  makeWithUUID({ projectId: project.id, description }).pipe(
    Effect.map(
      (task) => [task, TaskAddedEvent.make({ projectId: task.projectId, taskId: task.id })] as const
    )
  );

export const complete = (
  task: typeof Task.Type
): [typeof Task.Type, ReturnType<(typeof TaskCompletedEvent)['make']>] => [
  {
    ...task,
    completed: true
  },
  TaskCompletedEvent.make({ taskId: task.id })
];
