import { Effect } from 'effect';
import { UUIDGenerator } from '@hex-effect/core';
import { Task, TaskAddedEvent, TaskCompletedEvent } from './model.js';
import type { Project } from '../project/model.js';
import { Schema } from '@effect/schema';

export const addTaskToProject = (project: typeof Project.Type, description: string) =>
  Effect.gen(function* () {
    const uuid = yield* UUIDGenerator.generate();
    const task = yield* Schema.decode(Task)({
      projectId: project.id,
      id: uuid,
      description,
      completed: false
    });
    return [task, yield* TaskAddedEvent.make({ taskId: task.id, projectId: project.id })] as const;
  });

export const complete = (task: typeof Task.Type) =>
  Effect.gen(function* () {
    const completedTask: typeof Task.Type = { ...task, completed: true };
    return [completedTask, yield* TaskCompletedEvent.make({ taskId: task.id })] as const;
  });
