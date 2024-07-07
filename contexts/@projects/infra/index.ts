import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { Effect, Context, Layer, Ref, Config, Option } from 'effect';
import { UnknownException } from 'effect/Cause';
import { Kysely, CompiledQuery } from 'kysely';
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
import { omit } from 'effect/Struct';

/**
 * Infrastructure Services
 */

export class Database extends Context.Tag('KyselyEffect')<
  Database,
  {
    direct: Kysely<DB>;
    call: <A>(
      f: (db: Kysely<DB>) => Promise<A>
    ) => Effect.Effect<A, SQLiteError | UnknownException>;
  }
>() {}

export class SqliteClient extends Context.Tag('SqliteClient')<SqliteClient, { client: SQLite }>() {}

export class UnitOfWork extends Context.Tag('UnitOfWork')<
  UnitOfWork,
  {
    readonly write: (op: CompiledQuery) => Effect.Effect<void>;
    readonly commit: () => Effect.Effect<void, SQLiteError | UnknownException, Database>;
  }
>() {}

const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const sqlite = yield* SqliteClient;
    const kyselyClient = new Kysely<DB>({
      dialect: new BunSqliteDialect({ database: sqlite.client })
    });
    return {
      direct: kyselyClient,
      call: <A>(f: (db: Kysely<DB>) => Promise<A>) =>
        Effect.tryPromise({
          try: () => f(kyselyClient),
          catch: (error) => {
            return error instanceof SQLiteError ? error : new UnknownException(error);
          }
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
          const encoded = Schema.encodeSync(Project)(project);

          yield* uow.write(
            db.direct
              .insertInto('projects')
              .values({ id: encoded.id, title: encoded.title })
              .onConflict((oc) => oc.doUpdateSet((eb) => ({ title: eb.ref('excluded.title') })))
              .compile()
          );
        }),
      findById: (id) =>
        Effect.gen(function* () {
          const record = yield* db
            .call((db) =>
              db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst()
            )
            .pipe(Effect.orDie, Effect.map(Option.fromNullable));

          if (Option.isNone(record)) return Option.none<Project>();

          const project = Schema.decodeSync(Project)({
            id: record.value.id,
            title: record.value.title,
            _tag: 'Project'
          });

          return Option.some(project);
        })
    };
  })
);

/**
 * Sqlite does not have a bool type, so we will encode to 0 / 1
 */

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
          const encoded = Schema.encodeSync(RefinedTask)(task);
          yield* uow.write(
            db.direct
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
          const record = yield* db
            .call((db) =>
              db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst()
            )
            .pipe(Effect.orDie, Effect.map(Option.fromNullable));

          if (Option.isNone(record)) return Option.none<Task>();

          const decoded = Schema.decodeSync(RefinedTask)({
            ...record.value,
            _tag: 'Task'
          });

          return Option.some(new Task(decoded));
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

export const ApplicationLive = Layer.provideMerge(DomainServiceLive, InfrastructureLive);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function test() {
  const res = await Effect.zipLeft(
    createProject(CreateProject.make({ title: 'HELLO' })),
    Effect.serviceFunctions(UnitOfWork).commit()
  ).pipe(Effect.provide(ApplicationLive), Effect.runPromise);

  console.log(res);
}
