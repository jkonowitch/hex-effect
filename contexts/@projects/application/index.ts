import { Schema } from '@effect/schema';
import {
  Project,
  ProjectId,
  ProjectRepository,
  Task,
  TaskId,
  TaskRepository
} from '@projects/domain';
import { Effect, type Request, Option, pipe, Context, Scope } from 'effect';

/**
 * Requests
 */

export class ApplicationError extends Schema.TaggedError<ApplicationError>()('ApplicationError', {
  message: Schema.String
}) {}

export class CreateProject extends Schema.TaggedRequest<CreateProject>()(
  'CreateProject',
  Schema.Never,
  ProjectId,
  {
    title: Schema.String
  }
) {}

export class AddTask extends Schema.TaggedRequest<AddTask>()('AddTask', ApplicationError, TaskId, {
  description: Schema.String,
  projectId: ProjectId
}) {}

export class CompleteTask extends Schema.TaggedRequest<CompleteTask>()(
  'CompleteTask',
  ApplicationError,
  Schema.Void,
  {
    taskId: TaskId
  }
) {}

/**
 * Application Services
 */

export class TransactionalBoundary extends Context.Tag('TransactionalBoundary')<
  TransactionalBoundary,
  {
    begin(): Effect.Effect<void, never, Scope.Scope>;
    commit(): Effect.Effect<void, never, Scope.Scope>;
  }
>() {}

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
  }).pipe(withTransactionalBoundary) satisfies RequestHandler<CreateProject>;

export const addTask = ({ description, projectId }: AddTask) =>
  Effect.gen(function* () {
    const project = yield* pipe(
      Effect.serviceFunctions(ProjectRepository).findById(projectId),
      succeedOrNotFound(`No project ${projectId}`)
    );
    const task = yield* project.addTask(description);
    yield* Effect.serviceFunctions(TaskRepository).save(task);
    return task.id;
  }).pipe(withTransactionalBoundary) satisfies RequestHandler<AddTask>;

export const completeTask = ({ taskId }: CompleteTask) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;
    const task = yield* pipe(
      repo.findById(taskId),
      succeedOrNotFound(`No task ${taskId}`),
      Effect.flatMap(Task.complete)
    );
    yield* Effect.log('modified task', task);
    yield* repo.save(task);
  }).pipe(withTransactionalBoundary) satisfies RequestHandler<CompleteTask>;

/**
 * Utils
 */

function succeedOrNotFound<A, R>(message = 'Not Found') {
  return (eff: Effect.Effect<Option.Option<A>, never, R>) =>
    eff.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => new ApplicationError({ message }),
          onSome: Effect.succeed
        })
      )
    );
}

function withTransactionalBoundary<A, E, R>(
  eff: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | TransactionalBoundary> {
  return Effect.gen(function* () {
    const tx = yield* TransactionalBoundary;
    yield* tx.begin();
    const result = yield* eff;
    yield* tx.commit();
    return result;
  }).pipe(Effect.scoped);
}
