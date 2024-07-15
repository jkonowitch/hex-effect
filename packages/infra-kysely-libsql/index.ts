import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery
} from 'kysely';
import { Effect, Context, Layer, Ref, ConfigError, Scope, Data, Match } from 'effect';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';
import { Client, createClient, InValue, LibsqlError } from '@libsql/client';
import { LibsqlDialect } from './libsql-dialect.js';

export { LibsqlDialect };

export type Modes = Exclude<TransactionSession['_tag'], 'None'>;

export type TransactionalBoundary = {
  begin(mode: Modes): Effect.Effect<void, never, Scope.Scope>;
  commit(): Effect.Effect<void, never, Scope.Scope>;
  rollback(): Effect.Effect<void>;
};

type DBTX = {
  commit: Effect.Effect<void>;
  rollback: Effect.Effect<void>;
  tx: Kysely<unknown>;
};

type TransactionSession = Data.TaggedEnum<{
  Batched: { writes: ReadonlyArray<CompiledQuery<unknown>> };
  Serialized: { tx: DBTX };
  // eslint-disable-next-line @typescript-eslint/ban-types
  None: {};
}>;

const { Batched, Serialized, None, $match, $is } = Data.taggedEnum<TransactionSession>();

const initiateTransaction = (db: Kysely<unknown>) =>
  Effect.async<DBTX>((resume) => {
    const txSuspend = Promise.withResolvers();

    const operation = db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async function (tx) {
        const rollback = Effect.zipRight(
          Effect.sync(() => txSuspend.reject(new RollbackError())),
          Effect.tryPromise({
            try: () => operation,
            catch: (e) => (RollbackError.isRollback(e) ? e : new Error(`${e}`))
          })
        ).pipe(Effect.catchTag('RollbackError', Effect.ignore), Effect.orDie);

        const commit = Effect.zipRight(
          Effect.sync(() => txSuspend.resolve()),
          Effect.promise(() => operation)
        );

        resume(Effect.succeed({ rollback, commit, tx }));

        await txSuspend.promise;
      });
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TBoundaryTag = Context.Tag<any, TransactionalBoundary>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbSessionTag = Context.Tag<any, DatabaseSession<any, LibsqlError>>;

export const TransactionalBoundaryLive = <
  Boundary extends TBoundaryTag,
  Session extends DbSessionTag
>(
  TBoundary: Boundary,
  DbSession: Session,
  getConnectionString: Effect.Effect<string, ConfigError.ConfigError>
): Layer.Layer<
  Context.Tag.Identifier<Boundary> | Context.Tag.Identifier<Session>,
  ConfigError.ConfigError,
  never
> => {
  const sessionLayer = Layer.effect(
    DbSession,
    DatabaseConnection.pipe(
      Effect.map(({ db }) => DatabaseSessionLive(db) as Context.Tag.Service<Session>)
    )
  );
  const boundaryLayer = Layer.effect(
    TBoundary,
    makeTransactionalBoundary(DbSession) as Effect.Effect<
      Context.Tag.Service<Boundary>,
      never,
      Context.Tag.Identifier<Session>
    >
  );

  return boundaryLayer.pipe(
    Layer.provideMerge(sessionLayer),
    Layer.provide(DatabaseConnectionLive(getConnectionString))
  );
};

class RollbackError extends Data.TaggedError('RollbackError') {
  static isRollback(e: unknown): e is RollbackError {
    return e instanceof this && e._tag === 'RollbackError';
  }
}

class DatabaseConnection extends Context.Tag('DatabaseConnection')<
  DatabaseConnection,
  { client: Client; db: Kysely<unknown> }
>() {}

const DatabaseConnectionLive = (
  getConnectionString: Effect.Effect<string, ConfigError.ConfigError>
) =>
  Layer.scoped(
    DatabaseConnection,
    Effect.gen(function* () {
      const connectionString = yield* getConnectionString;
      const client = createClient({ url: connectionString });
      yield* Effect.addFinalizer(() => Effect.sync(() => client.close()));
      return {
        client,
        db: new Kysely({ dialect: new LibsqlDialect({ client }) })
      };
    })
  );

const makeTransactionalBoundary = <Session extends DbSessionTag>(
  DBSession: Session
): Effect.Effect<Context.Tag.Service<TBoundaryTag>, never, Context.Tag.Identifier<Session>> =>
  Effect.gen(function* () {
    const { client, db } = yield* DatabaseConnection;
    const databaseSession = yield* DBSession;
    const transactionSession = yield* Ref.make<TransactionSession>(None());

    const boundary: TransactionalBoundary = {
      begin: (mode) =>
        Match.value(mode).pipe(
          Match.when('Batched', () =>
            Effect.gen(function* () {
              yield* Ref.set(transactionSession, Batched({ writes: [] }));
              yield* Ref.set(databaseSession, DatabaseSessionBatched(db, transactionSession));
            })
          ),
          Match.when('Serialized', () =>
            Effect.gen(function* () {
              const tx = yield* initiateTransaction(db);
              yield* Ref.set(transactionSession, Serialized({ tx }));
              yield* Ref.set(databaseSession, DatabaseSessionLive(tx.tx));
            })
          ),
          Match.exhaustive
        ),
      commit: () =>
        // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
        Ref.get(transactionSession).pipe(
          Effect.flatMap(
            $match({
              Serialized: ({ tx }) => tx.commit,
              Batched: ({ writes }) =>
                Effect.promise(() =>
                  client.batch(
                    writes.map((w) => ({ args: w.parameters as Array<InValue>, sql: w.sql }))
                  )
                ),
              None: () => Effect.logError('Calling #commit when there is no transaction')
            })
          )
        ),
      rollback: () =>
        Ref.get(transactionSession).pipe(
          Effect.flatMap(
            $match({
              Serialized: ({ tx }) => tx.rollback,
              Batched: (a) => Ref.set(transactionSession, { ...a, writes: [] }),
              None: () => Effect.logError('Calling #rollback when there is no transaction')
            })
          )
        )
    };

    return boundary;
  });

const coldInstance = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

type RefValue<T> = T extends Ref.Ref<infer V> ? V : never;

const DatabaseSessionLive = (
  db: Kysely<unknown>
): RefValue<DatabaseSession<unknown, LibsqlError>> => {
  return {
    read<Q>(op: ReadonlyQuery<CompiledQuery<Q>>) {
      return Effect.promise(() => db.executeQuery(op));
    },
    write(op) {
      return Effect.promise(() => db.executeQuery(op));
    },
    queryBuilder: coldInstance
  };
};

const DatabaseSessionBatched = (
  hotInstance: Kysely<unknown>,
  transactionSession: Ref.Ref<TransactionSession>
): RefValue<DatabaseSession<unknown, LibsqlError>> => {
  return {
    ...DatabaseSessionLive(hotInstance),
    write(op) {
      return Ref.update(transactionSession, (a) =>
        $is('Batched')(a) ? { ...a, writes: [...a.writes, op] } : a
      );
    }
  };
};
