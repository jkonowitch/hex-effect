import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { Effect, Context, Layer, Ref, Config, Option, FiberRef, Scope } from 'effect';
import { UnknownException } from 'effect/Cause';
import { Kysely, CompiledQuery } from 'kysely';
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
import { TransactionalBoundary } from '@projects/application';
import type { DB } from './persistence/schema.js';

/**
 * Infrastructure Services
 */

type DatabaseSession = {
  direct: Kysely<DB>;
  call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, SQLiteError | UnknownException>;
};

export class UnitOfWork extends Context.Tag('UnitOfWork')<
  UnitOfWork,
  {
    readonly write: (op: CompiledQuery) => Effect.Effect<void>;
    readonly commit: () => Effect.Effect<void, SQLiteError | UnknownException>;
    readonly session: DatabaseSession;
  }
>() {}

const TransactionalBoundaryLive = Layer.effect(
  TransactionalBoundary,
  Effect.gen(function* () {
    const connectionString = yield* Config.string('PROJECT_DB');
    const readonlyConnection = new SQLite(connectionString, { readonly: true });
    const writableConnection = new SQLite(connectionString);

    return {
      begin: (opts) =>
        Effect.gen(function* () {
          yield* Effect.log('begin called');
          const uow = yield* UnitOfWorkLive(
            opts?.readonly ? readonlyConnection : writableConnection
          );
          yield* FiberRef.getAndUpdate(FiberRef.currentContext, Context.add(UnitOfWork, uow));
        }),
      commit: () =>
        Effect.gen(function* () {
          yield* Effect.log('commit called');
          const uow = yield* assertUnitOfWork;
          // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
          yield* uow.commit().pipe(Effect.orDie);
        })
    };
  })
);

const UnitOfWorkLive = (client: SQLite): Effect.Effect<UnitOfWork['Type'], never, Scope.Scope> =>
  Effect.gen(function* () {
    const units = yield* Ref.make<ReadonlyArray<CompiledQuery>>([]);
    const kyselyClient = new Kysely<DB>({
      dialect: new BunSqliteDialect({ database: client })
    });

    let committed = false;

    yield* Effect.addFinalizer(() =>
      committed ? Effect.void : Effect.logError('This unit of work was not committed!')
    );

    const session = {
      direct: kyselyClient,
      call: <A>(f: (db: Kysely<DB>) => Promise<A>) =>
        Effect.tryPromise({
          try: () => f(kyselyClient),
          catch: (error) => {
            return error instanceof SQLiteError ? error : new UnknownException(error);
          }
        })
    };
    return {
      write(op: CompiledQuery<unknown>) {
        return Ref.update(units, (a) => [...a, op]);
      },
      commit() {
        return Effect.gen(function* () {
          const operations = yield* Ref.getAndSet(units, []);
          if (operations.length === 0) return;
          yield* session.call((db) =>
            db.transaction().execute(async (tx) => {
              for (const op of operations) {
                await tx.executeQuery(op);
              }
            })
          );
          committed = true;
        });
      },
      session
    };
  });

const InfrastructureLive = TransactionalBoundaryLive;

/**
 * Application and Domain Service Implementations
 */

const assertUnitOfWork = Effect.serviceOptional(UnitOfWork).pipe(
  Effect.catchTag('NoSuchElementException', () =>
    Effect.dieMessage('TransactionalBoundary#begin not called!')
  )
);

const ProjectRepositoryLive = Layer.succeed(ProjectRepository, {
  nextId() {
    return Effect.succeed(ProjectId.make(nanoid()));
  },
  save: (project) =>
    Effect.gen(function* () {
      const uow = yield* assertUnitOfWork;
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
      const uow = yield* assertUnitOfWork;

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
      const uow = yield* assertUnitOfWork;
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
      const uow = yield* assertUnitOfWork;

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
      const uow = yield* assertUnitOfWork;

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

export const ApplicationLive = Layer.provideMerge(DomainServiceLive, InfrastructureLive);
