import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { Effect, Context, Layer, Ref, Config, Option, FiberRef, Scope } from 'effect';
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
import {
  AddTask,
  CompleteTask,
  CreateProject,
  GetProjectWithTasks,
  router,
  TransactionalBoundary
} from '@projects/application';
import { Router } from '@effect/rpc';

/**
 * Infrastructure Services
 */

export class SqliteClient extends Context.Tag('SqliteClient')<SqliteClient, { client: SQLite }>() {}

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

const SqliteClientLive = Layer.effect(
  SqliteClient,
  Config.string('PROJECT_DB').pipe(
    Effect.map((connectionString) => ({ client: new SQLite(connectionString) }))
  )
);

const TransactionalBoundaryLive = Layer.effect(
  TransactionalBoundary,
  Effect.gen(function* () {
    const sqlite = yield* SqliteClient;

    return {
      begin: () =>
        Effect.gen(function* () {
          yield* Effect.log('begin called');
          const uow = yield* UnitOfWorkLive(sqlite.client);
          yield* FiberRef.getAndUpdate(FiberRef.currentContext, Context.add(UnitOfWork, uow));
        }),
      commit: () =>
        Effect.gen(function* () {
          yield* Effect.log('commit called');

          const uow = yield* assertUnitOfWork;
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

    yield* Effect.addFinalizer(() =>
      units.get.pipe(
        Effect.map((u) => u.length),
        Effect.andThen((length) =>
          length === 0
            ? Effect.void
            : Effect.logError('Unit of Work has remaining, uncommitted units')
        )
      )
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
          yield* session.call((db) =>
            db.transaction().execute(async (tx) => {
              for (const op of operations) {
                await tx.executeQuery(op);
              }
            })
          );
        });
      },
      session
    };
  });

const InfrastructureLive = TransactionalBoundaryLive.pipe(Layer.provide(SqliteClientLive));

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

/* eslint-disable @typescript-eslint/no-unused-vars */

const handler = Router.toHandlerUndecoded(router);

async function execCreateProject() {
  const res = await handler(CreateProject.make({ title: 'HELLO' })).pipe(
    Effect.provide(ApplicationLive),
    Effect.runPromise
  );

  console.log(res);
}
async function execAddTask(projectId: Project['id']) {
  const res = await handler(AddTask.make({ projectId, description: 'kralf' })).pipe(
    Effect.provide(ApplicationLive),
    Effect.runPromise
  );

  console.log(res);
}

// await execAddTask(ProjectId.make('5shj6M008O2Z0TlUVt8f0'));

async function execCompleteTask(taskId: Task['id']) {
  const res = await handler(CompleteTask.make({ taskId })).pipe(
    Effect.provide(ApplicationLive),
    Effect.runPromise
  );

  console.log(res);
}

// await execCompleteTask(TaskId.make('wrX10xgdNV0VHAGJ5jmKx'));

async function execGetAllProjectsAndTasks() {
  const res = await handler(
    GetProjectWithTasks.make({ projectId: ProjectId.make('5shj6M008O2Z0TlUVt8f0') })
  ).pipe(Effect.provide(ApplicationLive), Effect.runPromise);

  console.log(res);
}
await execGetAllProjectsAndTasks();
