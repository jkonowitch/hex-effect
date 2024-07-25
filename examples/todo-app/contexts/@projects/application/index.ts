import { Router, Rpc } from '@effect/rpc';
import { Schema } from '@effect/schema';
import type { EventHandlerService as IEventHandlerService } from '@hex-effect/core';
import { withTransactionalBoundary } from '@hex-effect/infra-kysely-libsql-nats';
import {
  Project,
  TaskCompletedEvent,
  ProjectId,
  ProjectRepository,
  Task,
  TaskId,
  TaskRepository,
  ProjectDomainEvents
} from '@projects/domain';
import { Effect, type Request, Option, pipe, Context, Match } from 'effect';
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

export const ProjectWithTasks = Schema.Struct({
  project: Project,
  tasks: Schema.Array(Task)
});

export class GetProjectWithTasks extends Schema.TaggedRequest<GetProjectWithTasks>()(
  'GetProjectWithTasks',
  ApplicationError,
  ProjectWithTasks,
  {
    projectId: ProjectId
  }
) {}

export class GetAllProjects extends Schema.TaggedRequest<GetAllProjects>()(
  'GetAllProjects',
  ApplicationError,
  Schema.Array(Project),
  {}
) {}

/**
 * Use Cases
 */

const createProject = ({ title }: CreateProject) =>
  Effect.gen(function* () {
    const project = yield* Project.create(title);
    yield* Effect.serviceFunctions(ProjectRepository).save(project);
    return project.id;
  }).pipe(withTransactionalBoundary()) satisfies RequestHandler<CreateProject>;

const addTask = ({ description, projectId }: AddTask) =>
  pipe(
    Effect.serviceFunctions(ProjectRepository).findById(projectId),
    succeedOrNotFound(`No project ${projectId}`),
    Effect.flatMap((project) => project.addTask(description)),
    Effect.tap(Effect.serviceFunctions(TaskRepository).save),
    Effect.map(get('id')),
    withTransactionalBoundary()
  ) satisfies RequestHandler<AddTask>;

const completeTask = ({ taskId }: CompleteTask) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;
    const task = yield* pipe(
      repo.findById(taskId),
      succeedOrNotFound(`No task ${taskId}`),
      Effect.flatMap(Task.complete)
    );
    yield* repo.save(task);
  }) satisfies RequestHandler<CompleteTask>;

const projectWithTasks = ({ projectId }: GetProjectWithTasks) =>
  Effect.zip(
    Effect.serviceFunctions(ProjectRepository).findById(projectId),
    Effect.serviceFunctions(TaskRepository).findAllByProjectId(projectId),
    { concurrent: true }
  ).pipe(
    Effect.map(([project, tasks]) => Option.all({ project, tasks })),
    succeedOrNotFound()
  ) satisfies RequestHandler<GetProjectWithTasks>;

const getAllProjects = () =>
  Effect.serviceFunctions(ProjectRepository).findAll() satisfies RequestHandler<GetAllProjects>;

export const router = Router.make(
  Rpc.effect(CreateProject, createProject),
  Rpc.effect(AddTask, addTask),
  Rpc.effect(CompleteTask, completeTask),
  Rpc.effect(GetProjectWithTasks, projectWithTasks),
  Rpc.effect(GetAllProjects, getAllProjects)
);

export type AppRouter = typeof router;

/**
 * Event Handlers
 */

export const registerEvents = Effect.gen(function* () {
  const { register } = yield* EventHandlerService;

  yield* Effect.all(
    [
      register(
        TaskCompletedEvent,
        [{ context: '@projects', tag: 'TaskCompletedEvent' }],
        sendEmailAfterTaskCompleted,
        {
          $durableName: 'send-email-after-task-completed'
        }
      ),
      register(
        ProjectDomainEvents,
        [
          { context: '@projects', tag: 'ProjectCreatedEvent' },
          { context: '@projects', tag: 'TaskCompletedEvent' }
        ],
        someCompositeEventHandler,
        {
          $durableName: 'some-composite-event-handler'
        }
      )
    ],
    { concurrency: 'unbounded' }
  );
});

const sendEmailAfterTaskCompleted = (e: (typeof TaskCompletedEvent)['Type']) =>
  Effect.serviceFunctions(TaskRepository)
    .findById(e.taskId)
    .pipe(
      succeedOrNotFound(),
      Effect.andThen((task) => Effect.log(`Emailing regarding task: ${task.description}`))
    );

const someCompositeEventHandler = (e: (typeof ProjectDomainEvents)['Type']) =>
  Match.value(e).pipe(
    Match.tag('ProjectCreatedEvent', () => Effect.log('Project Created Event')),
    Match.tag('TaskCompletedEvent', () => Effect.log('Task Completed Event')),
    Match.exhaustive
  );

/**
 * Application Services
 */

export class EventHandlerService extends Context.Tag('ProjectEventHandlerService')<
  EventHandlerService,
  IEventHandlerService
>() {}

type RequestHandler<A extends Request.Request<unknown, unknown>> = Effect.Effect<
  Request.Request.Success<A>,
  Request.Request.Error<A>,
  unknown
>;

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