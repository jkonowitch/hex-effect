import { Effect } from 'effect';
import { UUIDGenerator } from '@hex-effect/core';
import { Task, TaskAddedEvent, TaskCompletedEvent, TaskId } from './model.js';
import type { Project } from '../project/model.js';

const makeWithUUID = (args: Omit<Parameters<(typeof Task)['make']>[0], 'id'>) =>
  UUIDGenerator.generate().pipe(
    Effect.map((uuid) => Task.make({ ...args, id: TaskId.make(uuid) }))
  );

export const addTaskToProject = (project: typeof Project.Type, description: string) =>
  Effect.gen(function* () {
    const task = yield* makeWithUUID({ description, projectId: project.id });
    return [task, yield* TaskAddedEvent.make({ taskId: task.id, projectId: project.id })] as const;
  });

export const complete = (task: typeof Task.Type) =>
  Effect.gen(function* () {
    const completedTask: typeof Task.Type = { ...task, completed: true };
    return [completedTask, yield* TaskCompletedEvent.make({ taskId: task.id })] as const;
  });
