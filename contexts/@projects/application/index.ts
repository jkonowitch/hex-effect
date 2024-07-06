import { Schema } from '@effect/schema';
import {
  Project,
  ProjectId,
  ProjectRepository,
  Task,
  TaskId,
  TaskRepository
} from '@projects/domain';
import { Effect, type Request } from 'effect';

/**
 * Requests
 */

export class CreateProject extends Schema.TaggedRequest<CreateProject>()(
  'CreateProject',
  Schema.Never,
  ProjectId,
  {
    title: Schema.String
  }
) {}

export class AddTask extends Schema.TaggedRequest<AddTask>()('AddTask', Schema.Never, TaskId, {
  description: Schema.String,
  projectId: ProjectId
}) {}

export class CompleteTask extends Schema.TaggedRequest<CompleteTask>()(
  'CompleteTask',
  Schema.Never,
  Schema.Void,
  {
    taskId: TaskId
  }
) {}

/**
 * Application Services
 */

type RequestHandler<A extends Request.Request<unknown, unknown>> = Effect.Effect<
  Request.Request.Success<A>,
  Request.Request.Error<A>,
  unknown
>;

export const createProject = ({ title }: CreateProject) =>
  Effect.gen(function* () {
    const project = yield* Project.create(title);
    yield* Effect.serviceFunctions(ProjectRepository).save(project);
    return project.id;
  }) satisfies RequestHandler<CreateProject>;

export const addTask = ({ description, projectId }: AddTask) =>
  Effect.gen(function* () {
    const project = yield* Effect.serviceFunctions(ProjectRepository).findById(projectId);
    const task = yield* project.addTask(description);
    yield* Effect.serviceFunctions(TaskRepository).save(task);
    return task.id;
  }) satisfies RequestHandler<AddTask>;

export const completeTask = ({ taskId }: CompleteTask) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;
    const task = yield* repo.findById(taskId).pipe(Effect.flatMap(Task.complete));
    repo.save(task);
  }) satisfies RequestHandler<CompleteTask>;
