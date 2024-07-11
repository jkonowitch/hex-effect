/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Dialect,
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery
} from 'kysely';
import { Effect, Context, Layer, Ref, ConfigError, Option } from 'effect';
import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { UnknownException } from 'effect/Cause';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { TransactionalBoundary } from '@hex-effect/core';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';

// export const makeTransactionalBoundary = <
//   TX extends Context.Tag<any, TransactionalBoundary>,
//   UOW extends Context.Tag<any, UnitOfWork<any, SQLiteError>>
// >(
//   txBoundaryTag: TX,
//   uowTag: UOW,
//   getConnectionString: Effect.Effect<string, ConfigError.ConfigError>
// ): Layer.Layer<Context.Tag.Identifier<TX>, ConfigError.ConfigError, never> =>
//   Layer.effect(
//     txBoundaryTag,
//     Effect.gen(function* () {
//       const connectionString = yield* getConnectionString;
//       const readonlyConnection = new SQLite(connectionString, { readonly: true });
//       const writableConnection = new SQLite(connectionString);

//       const uow = yield* uowTag;

//       const q: TransactionalBoundary = {
//         begin: (mode) =>
//           Effect.gen(function* () {
//             yield* Effect.log('begin called');
//             // const dialect = new BunSqliteDialect({
//             //   database: mode === 'readonly' ? readonlyConnection : writableConnection
//             // });

//             // yield* Ref.set(uow, Option.some(yield* UnitOfWorkLive(dialect)));
//           }),
//         commit: () =>
//           Effect.gen(function* () {
//             yield* Effect.log('commit called');
//             // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
//           }),
//         rollback: () => Effect.log('no op')
//       };

//       return q as Context.Tag.Service<TX>;
//     })
//   );

type TBoundaryTag = Context.Tag<any, TransactionalBoundary>;
type DbSessionTag = Context.Tag<any, DatabaseSession<any, SQLiteError>>;

export const TransactionalBoundaryLive = <
  Boundary extends TBoundaryTag,
  Session extends DbSessionTag
>(
  TBoundary: Boundary,
  DbSession: Session
): Layer.Layer<
  Context.Tag.Identifier<Boundary> | Context.Tag.Identifier<Session>,
  ConfigError.ConfigError,
  never
> => {
  const shmee = Layer.effect(
    DbSession,
    Effect.gen(function* () {
      const ref: Context.Tag.Service<DbSessionTag> = yield* Ref.make(NullDatabaseSession);
      return ref as Context.Tag.Service<Session>;
    })
  );
  const q = Layer.effect(
    TBoundary,
    Effect.gen(function* () {
      const service: Context.Tag.Service<TBoundaryTag> = yield* makeTransactionalBoundary(
        '' as any,
        DbSession
      );
      return service as Context.Tag.Service<Boundary>;
    })
  );

  return q.pipe(Layer.provideMerge(shmee));
};

const makeTransactionalBoundary = <
  Session extends Context.Tag<any, DatabaseSession<unknown, SQLiteError>>
>(
  getConnectionString: Effect.Effect<string, ConfigError.ConfigError>,
  DbSession: Session
): Effect.Effect<
  Context.Tag.Service<TBoundaryTag>,
  ConfigError.ConfigError,
  Context.Tag.Identifier<Session>
> =>
  Effect.gen(function* () {
    const connectionString = yield* getConnectionString;
    const client = new SQLite(connectionString);

    const uow = yield* DbSession;
    // const uow = yield* Effect.serviceFunctions(UnitOfWork).write();

    const boundary: TransactionalBoundary = {
      begin: (mode) =>
        Effect.gen(function* () {
          yield* Effect.log('begin called');
          // const dialect = new BunSqliteDialect({
          //   database: mode === 'readonly' ? readonlyConnection : writableConnection
          // });

          // yield* Ref.set(uow, Option.some(yield* UnitOfWorkLive(dialect)));
        }),
      commit: () =>
        Effect.gen(function* () {
          yield* Effect.log('commit called');
          // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
        }),
      rollback: () => Effect.log('no op')
    };

    return boundary;
  });

type RefValue<T> = T extends Ref.Ref<infer V> ? V : never;

const coldInstance = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

const NullDatabaseSession: RefValue<DatabaseSession<unknown, SQLiteError>> = {
  read: () => Effect.dieMessage('TransactionBoundary#begin not called!'),
  write: () => Effect.dieMessage('TransactionBoundary#begin not called!'),
  queryBuilder: coldInstance
};

const DatabaseSessionLive = (
  hotInstance: Kysely<unknown>
): RefValue<DatabaseSession<unknown, SQLiteError>> => {
  return {
    read<Q>(op: ReadonlyQuery<CompiledQuery<Q>>) {
      return Effect.promise(() => hotInstance.executeQuery(op));
    },
    write(op) {
      return Effect.promise(() => hotInstance.executeQuery(op));
    },
    queryBuilder: coldInstance
  };
};
