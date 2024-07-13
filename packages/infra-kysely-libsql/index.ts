import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery
} from 'kysely';
import { Effect, Context, Layer, Ref, ConfigError, Scope, Data, Match, Option } from 'effect';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';
import { Client, createClient, InValue, LibsqlError } from '@libsql/client';
import { LibsqlDialect } from './libsql-dialect.js';

export { LibsqlDialect };

export type Modes = TransactionSession['_tag'];

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
}>;

const { Batched, Serialized, $match, $is } = Data.taggedEnum<TransactionSession>();

const initiateTransaction = (hotInstance: Kysely<unknown>) =>
  Effect.async<DBTX>((resume) => {
    const txSuspend = Promise.withResolvers();

    const operation = hotInstance
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
    Effect.gen(function* () {
      const { client } = yield* DatabaseConnection;
      const ref: Context.Tag.Service<DbSessionTag> = yield* Ref.make(
        DatabaseSessionLive(new Kysely({ dialect: new LibsqlDialect({ client }) }))
      );
      return ref as Context.Tag.Service<Session>;
    })
  );
  const boundaryLayer = Layer.effect(
    TBoundary,
    Effect.gen(function* () {
      const service: Context.Tag.Service<TBoundaryTag> =
        yield* makeTransactionalBoundary(DbSession);
      return service as Context.Tag.Service<Boundary>;
    })
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
  { client: Client }
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
        client
      };
    })
  );

const makeTransactionalBoundary = <Session extends DbSessionTag>(
  DbSession: Session
): Effect.Effect<Context.Tag.Service<TBoundaryTag>, never, Context.Tag.Identifier<Session>> =>
  Effect.gen(function* () {
    const { client } = yield* DatabaseConnection;
    const session = yield* DbSession;
    const hotInstance = new Kysely({ dialect: new LibsqlDialect({ client }) });

    const transactionSession = yield* Ref.make<Option.Option<TransactionSession>>(None());

    const boundary: TransactionalBoundary = {
      begin: (mode) =>
        Match.value(mode).pipe(
          Match.when('Batched', () =>
            Effect.all([
              Ref.set(session, DatabaseSessionBatched(hotInstance, transactionSession)),
              Ref.set(transactionSession, Option.some(Batched({ writes: [] })))
            ])
          ),
          Match.when('Serialized', () =>
            Effect.gen(function* () {
              const tx = yield* initiateTransaction(hotInstance);
              yield* Ref.set(transactionSession, Option.some(Serialized({ tx })));
              yield* Ref.set(session, DatabaseSessionLive(tx.tx));
            })
          ),
          Match.exhaustive
        ),
      commit: () =>
        // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
        Ref.get(transactionSession).pipe(
          Effect.map(Option.getOrThrow),
          Effect.flatMap(
            $match({
              Serialized: ({ tx }) => tx.commit,
              Batched: ({ writes }) =>
                Effect.promise(() =>
                  client.batch(
                    writes.map((w) => ({ args: w.parameters as Array<InValue>, sql: w.sql }))
                  )
                )
            })
          )
        ),
      rollback: () =>
        Ref.get(transactionSession).pipe(
          Effect.map(Option.getOrThrow),
          Effect.map(
            $match({
              None: () => Effect.void,
              Serialized: ({ tx }) => tx.rollback,
              Batched: (a) => Ref.set(transactionSession, { ...a, writes: [] })
            })
          )
        )
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

const DatabaseSessionLive = (
  hotInstance: Kysely<unknown>
): RefValue<DatabaseSession<unknown, LibsqlError>> => {
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

const DatabaseSessionBatched = (
  hotInstance: Kysely<unknown>,
  transactionSession: Ref.Ref<TransactionSession>
): RefValue<DatabaseSession<unknown, LibsqlError>> => {
  return {
    read<Q>(op: ReadonlyQuery<CompiledQuery<Q>>) {
      return Effect.promise(() => hotInstance.executeQuery(op));
    },
    write(op) {
      return Ref.update(transactionSession, (a) =>
        $is('Batched')(a) ? { ...a, writes: [...a.writes, op] } : a
      );
    },
    queryBuilder: coldInstance
  };
};
