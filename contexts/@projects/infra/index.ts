import {
  Effect,
  Context,
  Layer,
  Option,
  FiberRef,
  Config,
  PubSub,
  Queue,
  ManagedRuntime
} from 'effect';
import {
  Project,
  ProjectDomainEvents,
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
import { router, ProjectTransactionalBoundary, CompleteTask } from '@projects/application';
import { Router } from '@effect/rpc';
import { createClient, type Client, type LibsqlError } from '@libsql/client';
import {
  createDatabaseSession,
  LibsqlDialect,
  makeTransactionalBoundary,
  TransactionalBoundary
} from '@hex-effect/infra-kysely-libsql';
import { Kysely } from 'kysely';
import { connect, JetStreamClient, RetentionPolicy, StreamInfo } from 'nats';
import { asyncExitHook } from 'exit-hook';
import { doThing, EventStore } from '@hex-effect/infra-kysely-libsql/messaging.js';

class DatabaseConnection extends Context.Tag('ProjectDatabaseConnection')<
  DatabaseConnection,
  { client: Client; db: Kysely<DB> }
>() {
  public static live = Layer.scoped(
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
}

class DatabaseSession extends Context.Tag('ProjectDatabaseSession')<
  DatabaseSession,
  DatabaseSessionService<DB, LibsqlError>
>() {
  public static live = Layer.scoped(
    DatabaseSession,
    DatabaseConnection.pipe(Effect.andThen(({ db }) => FiberRef.make(createDatabaseSession(db))))
  );
}

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
          const { write, queryBuilder } = yield* FiberRef.get(session);
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
          const { read, queryBuilder } = yield* FiberRef.get(session);

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
          const { write, queryBuilder } = yield* FiberRef.get(session);
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
          const { read, queryBuilder } = yield* FiberRef.get(session);

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
          const { read, queryBuilder } = yield* FiberRef.get(session);

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

const ProjectDomainPublisherLive = Layer.effect(
  ProjectDomainPublisher,
  Effect.gen(function* () {
    const session = yield* DatabaseSession;

    return {
      publish(event) {
        const encoded = Schema.encodeSync(ProjectDomainEvents)(event);
        return FiberRef.get(session).pipe(
          Effect.andThen(({ queryBuilder, write }) =>
            write(
              queryBuilder
                .insertInto('events')
                .values({
                  occurredOn: encoded.occurredOn,
                  id: encoded.messageId,
                  delivered: 0,
                  payload: JSON.stringify(encoded)
                })
                .compile()
            ).pipe(Effect.orDie)
          )
        );
      }
    };
  })
);

const DomainServiceLive = Layer.mergeAll(
  TaskRepositoryLive,
  ProjectRepositoryLive,
  ProjectDomainPublisherLive
);

class TransactionEvents extends Context.Tag('ProjectTransactionEvents')<
  TransactionEvents,
  PubSub.PubSub<keyof TransactionalBoundary>
>() {
  public static live = Layer.effect(
    TransactionEvents,
    PubSub.sliding<keyof TransactionalBoundary>(10)
  );
}

class NatsService extends Context.Tag('ProjectNatsConnection')<
  NatsService,
  { jetstream: JetStreamClient; stream: StreamInfo }
>() {
  public static live = Layer.scoped(
    NatsService,
    Effect.gen(function* () {
      const connection = yield* Effect.promise(() => connect());
      const jsm = yield* Effect.promise(() => connection.jetstreamManager());
      const applicationName = yield* Config.string('APPLICATION_NAME');
      const streamInfo = yield* Effect.promise(() =>
        jsm.streams.add({
          name: applicationName,
          subjects: [`${applicationName}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => connection.drain()).pipe(Effect.andThen(Effect.log('done')))
      );
      return { jetstream: connection.jetstream(), stream: streamInfo };
    })
  );
}

class EventStoreService extends Context.Tag('ProjectEventStore')<EventStoreService, EventStore>() {
  public static live = Layer.effect(
    EventStoreService,
    DatabaseSession.pipe(
      Effect.map((session) => ({
        getUnpublished: () =>
          Effect.gen(function* () {
            const { read, queryBuilder } = yield* FiberRef.get(session);
            return yield* read(
              queryBuilder
                .selectFrom('events')
                .select(({ fn, val }) => [
                  'payload',
                  'id',
                  fn<string>('json_extract', ['payload', val('$._tag')]).as('tag'),
                  fn<string>('json_extract', ['payload', val('$._context')]).as('context')
                ])
                .where('delivered', '=', 0)
                .compile()
            ).pipe(Effect.map((r) => r.rows));
          }),
        markPublished: (ids: string[]) =>
          Effect.gen(function* () {
            const { write, queryBuilder } = yield* FiberRef.get(session);
            yield* write(
              queryBuilder
                .updateTable('events')
                .set({ delivered: 1 })
                .where('id', 'in', ids)
                .compile()
            );
          })
      }))
    )
  );
}

const Kralf = Layer.scopedDiscard(
  Effect.gen(function* () {
    const pub = yield* TransactionEvents;
    const dequeue = yield* PubSub.subscribe(pub);
    const { jetstream } = yield* NatsService;
    const q = doThing(yield* EventStoreService, jetstream);
    yield* Queue.take(dequeue)
      .pipe(
        Effect.map((a) => a === 'commit'),
        Effect.if({
          onTrue: () =>
            Effect.retry(q.pipe(Effect.tapError((e) => Effect.logError(e))), { times: 3 }),
          onFalse: () => Effect.void
        }),
        Effect.forever
      )
      .pipe(Effect.forkScoped);
  })
).pipe(Layer.provide(NatsService.live), Layer.provide(EventStoreService.live));

const TransactionalBoundaryLive = Layer.effect(
  ProjectTransactionalBoundary,
  Effect.all([DatabaseConnection, DatabaseSession, TransactionEvents]).pipe(
    Effect.andThen((deps) => makeTransactionalBoundary(...deps))
  )
).pipe(Layer.provide(Kralf), Layer.provide(TransactionEvents.live));

const InfrastructureLive = TransactionalBoundaryLive.pipe(
  Layer.provideMerge(DatabaseSession.live),
  Layer.provideMerge(DatabaseConnection.live)
);

const runtime = ManagedRuntime.make(InfrastructureLive);

// export const ApplicationLive = Layer.provideMerge(DomainServiceLive, InfrastructureLive);

const handler = Router.toHandlerUndecoded(router);

// const res = await handler(
//   CompleteTask.make({ taskId: TaskId.make('SS8yZPEBhpn_6W1_hB0ay') })
//   // AddTask.make({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1'), description: 'shmee' })
//   // GetProjectWithTasks.make({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
// ).pipe(Effect.provide(DomainServiceLive), runtime.runPromise);

const program = Effect.zip(
  handler(CompleteTask.make({ taskId: TaskId.make('SS8yZPEBhpn_6W1_hB0ay') })),
  Effect.log('kralf'),
  { concurrent: true }
);

await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);
await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);

asyncExitHook(
  async () => {
    await runtime.dispose();
  },
  { wait: 500 }
);
