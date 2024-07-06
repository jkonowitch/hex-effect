import type { Database as SqliteDB } from 'better-sqlite3';
import SQLite from 'better-sqlite3';
import { Data, Effect, Context, Layer, Ref, Config } from 'effect';
import type { UnknownException } from 'effect/Cause';
import { Kysely, CompiledQuery, SqliteDialect } from 'kysely';
import type { DB } from './persistence/schema.js';
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

/**
 * Infrastructure Services
 */

export class KyselyError extends Data.TaggedError('KyselyError')<{
  readonly error: unknown;
}> {}

export class Database extends Context.Tag('KyselyEffect')<
  Database,
  {
    direct: Kysely<DB>;
    call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, KyselyError>;
  }
>() {}

export class SqliteClient extends Context.Tag('SqliteClient')<
  SqliteClient,
  { client: SqliteDB }
>() {}

export class UnitOfWork extends Context.Tag('UnitOfWork')<
  UnitOfWork,
  {
    readonly write: (op: CompiledQuery) => Effect.Effect<void>;
    readonly commit: () => Effect.Effect<void, KyselyError | UnknownException, Database>;
  }
>() {}

const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const sqlite = yield* SqliteClient;
    const kyselyClient = new Kysely<DB>({
      dialect: new SqliteDialect({ database: sqlite.client })
    });
    return {
      direct: kyselyClient,
      call: <A>(f: (db: Kysely<DB>) => Promise<A>) =>
        Effect.tryPromise({
          try: () => f(kyselyClient),
          catch: (error) => new KyselyError({ error })
        })
    };
  })
);

const SqliteClientLive = Layer.effect(
  SqliteClient,
  Config.string('PROJECT_DB').pipe(
    Effect.map((connectionString) => ({ client: new SQLite(connectionString) }))
  )
);

const UnitOfWorkLive = Layer.effect(
  UnitOfWork,
  Effect.gen(function* () {
    const units = yield* Ref.make<ReadonlyArray<CompiledQuery>>([]);
    return {
      write(op) {
        return Ref.update(units, (a) => [...a, op]);
      },
      commit: () =>
        Effect.gen(function* () {
          const operations = yield* Ref.getAndSet(units, []);
          const db = yield* Database;
          yield* db.call((db) =>
            db.transaction().execute(async (tx) => {
              for (const op of operations) {
                await tx.executeQuery(op);
              }
            })
          );
        })
    };
  })
);

const InfrastructureLive = Layer.merge(UnitOfWorkLive, DatabaseLive).pipe(
  Layer.provide(SqliteClientLive)
);

/**
 * Application and Domain Service Implementations
 */

const ProjectRepositoryLive = Layer.effect(
  ProjectRepository,
  Effect.gen(function* () {
    const uow = yield* UnitOfWork;
    const db = yield* Database;

    return {
      nextId() {
        return Effect.succeed(ProjectId.make(nanoid()));
      },
      save: (project) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.encode(Project)(project).pipe(Effect.orDie);
          yield* uow.write(
            db.direct
              .insertInto('projects')
              .values({ id: decoded.id, title: decoded.title })
              .compile()
          );
        }),
      findById: (id) =>
        Effect.gen(function* () {
          const record = yield* db
            .call((db) =>
              db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
            )
            .pipe(Effect.orDie);
          return yield* Schema.decode(Project)({
            id: record.id,
            title: record.title,
            _tag: 'Project'
          }).pipe(Effect.orDie);
        })
    };
  })
);

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
  Effect.gen(function* () {
    const uow = yield* UnitOfWork;
    const db = yield* Database;

    return {
      nextId() {
        return Effect.succeed(TaskId.make(nanoid()));
      },
      save: (task) =>
        Effect.gen(function* () {
          const encoded = yield* Schema.encode(RefinedTask)(task).pipe(Effect.orDie);
          yield* uow
            .write(db.direct.insertInto('tasks').values(encoded).compile())
            .pipe(Effect.orDie);
        }),
      findById: (id) =>
        Effect.gen(function* () {
          const record = yield* db
            .call((db) =>
              db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
            )
            .pipe(Effect.orDie);

          const decoded = yield* Schema.decode(RefinedTask)({
            ...record,
            _tag: 'Task'
          }).pipe(Effect.orDie);

          return new Task(decoded);
        })
    };
  })
);

const ProjectDomainPublisherLive = Layer.succeed(ProjectDomainPublisher, {
  publish: () => Effect.void
});

const DomainServiceLive = Layer.mergeAll(
  TaskRepositoryLive,
  ProjectRepositoryLive,
  ProjectDomainPublisherLive
);

export const ApplicationLive = Layer.provide(DomainServiceLive, InfrastructureLive);
