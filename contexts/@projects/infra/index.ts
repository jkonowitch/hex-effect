import { Effect, Context, Layer, Option, Config } from 'effect';
import {
  Project,
  ProjectDomainPublisher,
  ProjectId,
  ProjectRepository,
  Task,
  TaskId,
  TaskRepository
} from '@projects/domain';
import { Schema } from '@effect/schema';
import { nanoid } from 'nanoid';
import { omit } from 'effect/Struct';
import type { DB } from './persistence/schema.js';
import { assertUnitOfWork, UnitOfWork } from '@hex-effect/infra';
import { GetProjectWithTasks, ProjectTransactionalBoundary, router } from '@projects/application';
import { Router } from '@effect/rpc';
import type { SQLiteError } from 'bun:sqlite';
import { makeTransactionalBoundary } from '@hex-effect/infra-bun-sqlite-kysely';

class ProjectUnitOfWork extends Context.Tag('ProjectUnitOfWork')<
  ProjectUnitOfWork,
  UnitOfWork<DB, SQLiteError>
>() {}

const unitOfWork = assertUnitOfWork(ProjectUnitOfWork);

/**
 * Application and Domain Service Implementations
 */

const ProjectRepositoryLive = Layer.succeed(ProjectRepository, {
  nextId() {
    return Effect.succeed(ProjectId.make(nanoid()));
  },
  save: (project) =>
    Effect.gen(function* () {
      const uow = yield* unitOfWork;
      const encoded = Schema.encodeSync(Project)(project);

      yield* uow.write(
        uow.session.direct
          .insertInto('projects')
          .values({ id: encoded.id, title: encoded.title })
          .onConflict((oc) => oc.doUpdateSet((eb) => ({ title: eb.ref('excluded.title') })))
          .compile()
      );
    }),
  findById: (id) =>
    Effect.gen(function* () {
      const uow = yield* unitOfWork;

      const record = yield* uow.session
        .call((db) => db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst())
        .pipe(Effect.orDie, Effect.map(Option.fromNullable));

      if (Option.isNone(record)) return Option.none<Project>();

      const project = Schema.decodeSync(Project)({
        id: record.value.id,
        title: record.value.title,
        _tag: 'Project'
      });

      return Option.some(project);
    })
});

// Sqlite does not have a bool type, so we will encode to 0 / 1
const RefinedTask = Schema.Struct({
  ...Task.fields,
  completed: Schema.transform(Schema.Int, Schema.Boolean, {
    strict: true,
    decode: (fromA) => (fromA === 0 ? false : true),
    encode: (toI) => (toI ? 1 : 0)
  })
});

const TaskRepositoryLive = Layer.succeed(TaskRepository, {
  nextId() {
    return Effect.succeed(TaskId.make(nanoid()));
  },
  save: (task) =>
    Effect.gen(function* () {
      const encoded = Schema.encodeSync(RefinedTask)(task);
      const uow = yield* unitOfWork;
      yield* uow.write(
        uow.session.direct
          .insertInto('tasks')
          .values(omit(encoded, '_tag'))
          .onConflict((oc) =>
            oc.doUpdateSet((eb) => ({
              completed: eb.ref('excluded.completed'),
              description: eb.ref('excluded.description')
            }))
          )
          .compile()
      );
    }),
  findById: (id) =>
    Effect.gen(function* () {
      const uow = yield* unitOfWork;

      const record = yield* uow.session
        .call((db) => db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst())
        .pipe(Effect.orDie, Effect.map(Option.fromNullable));

      if (Option.isNone(record)) return Option.none<Task>();

      const decoded = Schema.decodeSync(RefinedTask)({
        ...record.value,
        _tag: 'Task'
      });

      return Option.some(new Task(decoded));
    }),
  findAllByProjectId: (projectId) =>
    Effect.gen(function* () {
      const uow = yield* unitOfWork;

      const records = yield* uow.session
        .call((db) =>
          db.selectFrom('tasks').selectAll().where('projectId', '=', projectId).execute()
        )
        .pipe(Effect.orDie);

      return Option.some(
        records.map((v) => Schema.decodeSync(RefinedTask)({ ...v, _tag: 'Task' }))
      );
    })
});

const ProjectDomainPublisherLive = Layer.succeed(ProjectDomainPublisher, {
  publish: () => Effect.void
});

const DomainServiceLive = Layer.mergeAll(
  TaskRepositoryLive,
  ProjectRepositoryLive,
  ProjectDomainPublisherLive
);

export const ApplicationLive = Layer.provideMerge(
  DomainServiceLive,
  makeTransactionalBoundary(
    ProjectTransactionalBoundary,
    ProjectUnitOfWork,
    Config.string('PROJECT_DB')
  )
);

const handler = Router.toHandlerUndecoded(router);

const res = await handler(
  GetProjectWithTasks.make({ projectId: ProjectId.make('5shj6M008O2Z0TlUVt8f0') })
).pipe(Effect.provide(ApplicationLive), Effect.runPromise);

console.log(res);
