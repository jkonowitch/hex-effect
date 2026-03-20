import { Project, Task } from '@projects/domain';
import { Context, Effect, Option, Either } from 'effect';
import {
  DeleteTask,
  FindProjectById,
  FindTaskById,
  GetAllProjects,
  GetTasksByProjectId,
  SaveProject,
  SaveTask,
  UpdateTask
} from './services.js';
import { IsolationLevel, withTXBoundary } from '@hex-effect/core';
import { ApplicationError, ErrorKinds } from './error.js';

const findOrNotFound = (
  <E2>(onNone: () => E2) =>
  <Id, Entity, E, R>(
    tag: Context.Tag<R, { findById: (id: Id) => Effect.Effect<Option.Option<Entity>, E, never> }>,
    id: Id
  ) =>
    Effect.serviceFunctions(tag)
      .findById(id)
      .pipe(Effect.flatMap((opt) => Either.fromOption(opt, onNone)))
)(() => new ApplicationError({ kind: ErrorKinds.NotFound }));

export const createProject = (title: string) =>
  Project.Service.createProject(title).pipe(
    Effect.tap(([project]) => Effect.serviceFunctions(SaveProject).save(project)),
    Effect.map(([, event]) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );

export const addTaskToProject = (params: { projectId: string; description: string }) =>
  findOrNotFound(FindProjectById, Project.Model.ProjectId.make(params.projectId)).pipe(
    Effect.andThen((project) => Task.Service.addTaskToProject(project, params.description)),
    Effect.tap(([task]) => Effect.serviceFunctions(SaveTask).save(task)),
    Effect.map(([, event]) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );

export const removeTask = (taskId: string) => {
  const id = Task.Model.TaskId.make(taskId);
  return Task.Model.TaskRemovedEvent.make({ taskId: id }).pipe(
    Effect.tap(() => Effect.serviceFunctions(DeleteTask).delete(id)),
    Effect.map((event) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );
};

export const completeTask = (taskId: string) =>
  findOrNotFound(FindTaskById, Task.Model.TaskId.make(taskId)).pipe(
    Effect.flatMap((task) => Task.Service.complete(task)),
    Effect.tap(([task]) => Effect.serviceFunctions(UpdateTask).update(task)),
    Effect.map(([, event]) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );

export const getAllProjects = Effect.serviceFunctions(GetAllProjects).getAll();

export const getProjectWithTasks = (projectId: string) =>
  Effect.serviceFunctions(FindProjectById)
    .findById(Project.Model.ProjectId.make(projectId))
    .pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (project) =>
            Effect.serviceFunctions(GetTasksByProjectId)
              .getByProjectId(project.id)
              .pipe(Effect.map((tasks) => Option.some({ ...project, tasks })))
        })
      )
    );
