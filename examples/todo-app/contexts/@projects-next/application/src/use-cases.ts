import { Project, Task } from '@projects-next/domain';
import { Effect, Option } from 'effect';
import { FindProjectById, SaveProject, SaveTask } from './services.js';
import { IsolationLevel, withTXBoundary } from '@hex-effect/core';

export const createProject = (title: string) =>
  Effect.gen(function* () {
    const [project, event] = yield* Project.Service.createProject(title);
    yield* Effect.serviceFunctions(SaveProject).save(project);
    return [event];
  }).pipe(withTXBoundary(IsolationLevel.Batched));

export const addTaskToProject = (params: { projectId: string; description: string }) =>
  Effect.gen(function* () {
    const project = yield* Effect.serviceFunctions(FindProjectById).findById(
      Project.Model.ProjectId.make(params.projectId)
    );
    if (Option.isNone(project)) {
      return yield* Effect.fail('Not found');
    } else {
      const [task, event] = yield* Task.Service.addTaskToProject(project.value, params.description);
      yield* Effect.serviceFunctions(SaveTask).save(task);
      return [event];
    }
  }).pipe(withTXBoundary(IsolationLevel.Batched));
