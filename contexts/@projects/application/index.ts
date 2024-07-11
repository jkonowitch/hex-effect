import { Router, Rpc } from '@effect/rpc';
import { Schema } from '@effect/schema';
import { TransactionalBoundary } from '@hex-effect/core';
import {
  Project,
  ProjectDomainEvents,
  ProjectId,
  ProjectRepository,
  Task,
  TaskId,
  TaskRepository
} from '@projects/domain';
import { Effect, type Request, Option, pipe, Scope, Match, Context } from 'effect';
import { get } from 'effect/Struct';

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

export class GetProjectWithTasks extends Schema.TaggedRequest<GetProjectWithTasks>()(
  'GetProjectWithTasks',
  ApplicationError,
  Schema.Struct({
    project: Project,
    tasks: Schema.Array(Task)
  }),
  {
    projectId: ProjectId
  }
) {}

export class ProcessEvent extends Schema.TaggedRequest<ProcessEvent>()(
  'ProcessEvent',
  ApplicationError,
  Schema.Void,
  { event: ProjectDomainEvents }
) {}

/**
 * Application Services
 */

export class ProjectTransactionalBoundary extends Context.Tag('ProjectTransactionalBoundary')<
  ProjectTransactionalBoundary,
  TransactionalBoundary
>() {}

type RequestHandler<A extends Request.Request<unknown, unknown>> = Effect.Effect<
  Request.Request.Success<A>,
  Request.Request.Error<A>,
  unknown
>;

const createProject = ({ title }: CreateProject) =>
  Effect.gen(function* () {
    const project = yield* Project.create(title);
    yield* Effect.serviceFunctions(ProjectRepository).save(project);
    return project.id;
  }).pipe(withTransactionalBoundary('write-lazy')) satisfies RequestHandler<CreateProject>;

const addTask = ({ description, projectId }: AddTask) =>
  pipe(
    Effect.serviceFunctions(ProjectRepository).findById(projectId),
    succeedOrNotFound(`No project ${projectId}`),
    Effect.flatMap((project) => project.addTask(description)),
    Effect.tap(Effect.serviceFunctions(TaskRepository).save),
    Effect.map(get('id')),
    withTransactionalBoundary('write-lazy')
  ) satisfies RequestHandler<AddTask>;

const completeTask = ({ taskId }: CompleteTask) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;
    const task = yield* pipe(
      repo.findById(taskId),
      succeedOrNotFound(`No task ${taskId}`),
      Effect.flatMap(Task.complete)
    );
    yield* Effect.log('modified task', task);
    yield* repo.save(task);
  }).pipe(withTransactionalBoundary('write-lazy')) satisfies RequestHandler<CompleteTask>;

const projectWithTasks = ({ projectId }: GetProjectWithTasks) =>
  Effect.zip(
    Effect.serviceFunctions(ProjectRepository).findById(projectId),
    Effect.serviceFunctions(TaskRepository).findAllByProjectId(projectId),
    { concurrent: true }
  ).pipe(
    Effect.map(([project, tasks]) => Option.all({ project, tasks })),
    succeedOrNotFound(),
    withTransactionalBoundary()
  ) satisfies RequestHandler<GetProjectWithTasks>;

const processEvent = ({ event }: ProcessEvent) =>
  Match.value(event)
    .pipe(
      Match.tag('ProjectCreatedEvent', (e) =>
        Effect.log(`Emailing user that they have created a new project with id: ${e.projectId}`)
      ),
      Match.tag('TaskCompletedEvent', () => Effect.void),
      Match.exhaustive
    )
    // don't actually need this, but in general these event handlers will execute domain behavior
    .pipe(withTransactionalBoundary('write-lazy')) satisfies RequestHandler<ProcessEvent>;

export const router = Router.make(
  Rpc.effect(CreateProject, createProject),
  Rpc.effect(AddTask, addTask),
  Rpc.effect(CompleteTask, completeTask),
  Rpc.effect(GetProjectWithTasks, projectWithTasks),
  Rpc.effect(ProcessEvent, processEvent)
);

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

function withTransactionalBoundary(
  mode: Parameters<ProjectTransactionalBoundary['Type']['begin']>[0] = 'read-lazy'
) {
  return <A, E, R>(
    eff: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, ProjectTransactionalBoundary | Exclude<R, Scope.Scope>> =>
    Effect.gen(function* () {
      const tx = yield* ProjectTransactionalBoundary;
      yield* tx.begin(mode);
      const result = yield* eff.pipe(Effect.tapError(tx.rollback));
      yield* tx.commit();
      return result;
    }).pipe(Effect.scoped);
}
