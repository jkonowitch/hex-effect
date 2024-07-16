import { Effect, Context, Layer, Option, Ref, Config, PubSub, Queue } from 'effect';
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
import type { DatabaseSession as DatabaseSessionService } from '@hex-effect/infra';
import {
  GetProjectWithTasks,
  router,
  ProjectTransactionalBoundary,
  AddTask
} from '@projects/application';
import { Router } from '@effect/rpc';
import { createClient, type Client, type LibsqlError } from '@libsql/client';
import {
  createDatabaseSession,
  LibsqlDialect,
  makeTransactionalBoundary,
  TransactionalBoundary
} from '@hex-effect/infra-kysely-libsql';
import { Kysely } from 'kysely';

class DatabaseSession extends Context.Tag('ProjectDatabaseSession')<
  DatabaseSession,
  DatabaseSessionService<DB, LibsqlError>
>() {}

class DatabaseConnection extends Context.Tag('ProjectDatabaseConnection')<
  DatabaseConnection,
  { client: Client; db: Kysely<DB> }
>() {}

/**
 * Application and Domain Service Implementations
 */

const ProjectRepositoryLive = Layer.effect(
  ProjectRepository,
  DatabaseSession.pipe(
    Effect.map((session) => ({
      nextId() {
        return Effect.succeed(ProjectId.make(nanoid()));
      },
      save: (project: Project) =>
        Effect.gen(function* () {
          const encoded = Schema.encodeSync(Project)(project);
          const { write, queryBuilder } = yield* Ref.get(session);
          yield* write(
            queryBuilder
              .insertInto('projects')
              .values({ id: encoded.id, title: encoded.title })
              .onConflict((oc) => oc.doUpdateSet((eb) => ({ title: eb.ref('excluded.title') })))
              .compile()
          ).pipe(Effect.orDie);
        }),
      findById: (id: (typeof ProjectId)['Type']) =>
        Effect.gen(function* () {
          const { read, queryBuilder } = yield* Ref.get(session);

          const record = yield* read(
            queryBuilder.selectFrom('projects').selectAll().where('id', '=', id).compile()
          ).pipe(
            Effect.orDie,
            Effect.map((result) => Option.fromNullable(result.rows.at(0)))
          );

          if (Option.isNone(record)) return Option.none<Project>();

          const project = Schema.decodeSync(Project)({
            id: record.value.id,
            title: record.value.title,
            _tag: 'Project'
          });

          return Option.some(project);
        })
    }))
  )
);

// Sqlite does not have a bool type, so we will encode to 0 / 1
const RefinedTask = Schema.Struct({
  ...Task.fields,
  completed: Schema.transform(Schema.Int, Schema.Boolean, {
    strict: true,
    decode: (fromA) => (fromA === 0 ? false : true),
    encode: (toI) => (toI ? 1 : 0)
  })
});

const TaskRepositoryLive = Layer.effect(
  TaskRepository,
  DatabaseSession.pipe(
    Effect.map((session) => ({
      nextId() {
        return Effect.succeed(TaskId.make(nanoid()));
      },
      save: (task: Task) =>
        Effect.gen(function* () {
          const encoded = Schema.encodeSync(RefinedTask)(task);
          const { write, queryBuilder } = yield* Ref.get(session);
          yield* write(
            queryBuilder
              .insertInto('tasks')
              .values(omit(encoded, '_tag'))
              .onConflict((oc) =>
                oc.doUpdateSet((eb) => ({
                  completed: eb.ref('excluded.completed'),
                  description: eb.ref('excluded.description')
                }))
              )
              .compile()
          ).pipe(Effect.orDie);
        }),
      findById: (id: (typeof TaskId)['Type']) =>
        Effect.gen(function* () {
          const { read, queryBuilder } = yield* Ref.get(session);

          const record = yield* read(
            queryBuilder.selectFrom('tasks').selectAll().where('id', '=', id).compile()
          ).pipe(
            Effect.orDie,
            Effect.map((result) => Option.fromNullable(result.rows.at(0)))
          );

          if (Option.isNone(record)) return Option.none<Task>();

          const decoded = Schema.decodeSync(RefinedTask)({
            ...record.value,
            _tag: 'Task'
          });

          return Option.some(new Task(decoded));
        }),
      findAllByProjectId: (projectId: (typeof ProjectId)['Type']) =>
        Effect.gen(function* () {
          const { read, queryBuilder } = yield* Ref.get(session);

          const { rows: records } = yield* read(
            queryBuilder
              .selectFrom('tasks')
              .selectAll()
              .where('projectId', '=', projectId)
              .compile()
          ).pipe(Effect.orDie);

          return Option.some(
            records.map((v) => Schema.decodeSync(RefinedTask)({ ...v, _tag: 'Task' }))
          );
        })
    }))
  )
);

const ProjectDomainPublisherLive = Layer.succeed(ProjectDomainPublisher, {
  publish: () => Effect.void
});

const DomainServiceLive = Layer.mergeAll(
  TaskRepositoryLive,
  ProjectRepositoryLive,
  ProjectDomainPublisherLive
);

const DatabaseConnectionLive = Layer.scoped(
  DatabaseConnection,
  Effect.gen(function* () {
    const connectionString = yield* Config.string('PROJECT_DB');
    const client = createClient({ url: connectionString });
    yield* Effect.addFinalizer(() => Effect.sync(() => client.close()));
    return {
      client,
      db: new Kysely<DB>({ dialect: new LibsqlDialect({ client }) })
    };
  })
);

const DatabaseSessionLive = Layer.effect(
  DatabaseSession,
  DatabaseConnection.pipe(Effect.andThen(({ db }) => Ref.make(createDatabaseSession(db))))
);

class TransactionEvents extends Context.Tag('ProjectTransactionEvents')<
  TransactionEvents,
  PubSub.PubSub<keyof TransactionalBoundary>
>() {}

const TransactionEventsLive = Layer.effect(
  TransactionEvents,
  PubSub.sliding<keyof TransactionalBoundary>(10)
);

const Kralf = Layer.scopedDiscard(
  Effect.gen(function* () {
    const pub = yield* TransactionEvents;

    const dequeue = yield* PubSub.subscribe(pub);

    yield* Queue.take(dequeue)
      .pipe(
        Effect.map((a) => a === 'commit'),
        Effect.if({ onTrue: () => Effect.log('committed'), onFalse: () => Effect.void }),
        Effect.forever
      )
      .pipe(Effect.forkDaemon);
  })
);

const TransactionalBoundaryLive = Layer.effect(
  ProjectTransactionalBoundary,
  Effect.all([DatabaseConnection, DatabaseSession, TransactionEvents]).pipe(
    Effect.andThen((deps) => makeTransactionalBoundary(...deps))
  )
).pipe(Layer.provide(Kralf), Layer.provide(TransactionEventsLive));

const InfrastructureLive = TransactionalBoundaryLive.pipe(
  Layer.provideMerge(DatabaseSessionLive),
  Layer.provideMerge(DatabaseConnectionLive)
);

export const ApplicationLive = Layer.provideMerge(DomainServiceLive, InfrastructureLive);

const handler = Router.toHandlerUndecoded(router);

const res = await handler(
  AddTask.make({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1'), description: 'tight' })
  // GetProjectWithTasks.make({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
).pipe(Effect.provide(ApplicationLive), Effect.runPromise);

console.log(res);
