import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery
} from 'kysely';
import { Effect, Context, Layer, Ref, ConfigError, Scope } from 'effect';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';
import { createClient, LibsqlError } from '@libsql/client';
import { LibsqlDialect } from './libsql-dialect.js';

export { LibsqlDialect };


export type TransactionalBoundary = {
  begin(mode: Modes): Effect.Effect<void, never, Scope.Scope>;
  commit(): Effect.Effect<void, never, Scope.Scope>;
  rollback(): Effect.Effect<void>;
};

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
      const ref: Context.Tag.Service<DbSessionTag> = yield* Ref.make(NullDatabaseSession);
      return ref as Context.Tag.Service<Session>;
    })
  );
  const boundaryLayer = Layer.effect(
    TBoundary,
    Effect.gen(function* () {
      const connectionString = yield* getConnectionString;
      const service: Context.Tag.Service<TBoundaryTag> = yield* makeTransactionalBoundary(
        DbSession,
        connectionString
      );
      return service as Context.Tag.Service<Boundary>;
    })
  );

  return boundaryLayer.pipe(Layer.provideMerge(sessionLayer));
};

type TransactionSession = { writes: ReadonlyArray<CompiledQuery<unknown>>; mode: Modes };

const makeTransactionalBoundary = <Session extends DbSessionTag>(
  DbSession: Session,
  connectionString: string
): Effect.Effect<
  Context.Tag.Service<TBoundaryTag>,
  ConfigError.ConfigError,
  Context.Tag.Identifier<Session>
> =>
  Effect.gen(function* () {
    const client = createClient({ url: connectionString });
    const session = yield* DbSession;
    const hotInstance = new Kysely({ dialect: new LibsqlDialect({ client }) });

    let transactionSession: Ref.Ref<TransactionSession>;

    const boundary: TransactionalBoundary = {
      begin: (mode) =>
        Effect.gen(function* () {
          yield* Effect.log('begin called');
          transactionSession = yield* Ref.make<TransactionSession>({ writes: [], mode });
          yield* Ref.set(session, DatabaseSessionLive(hotInstance));
        }),
      commit: () =>
        Effect.gen(function* () {
          yield* Effect.log('commit called');
          yield* Ref.get(transactionSession).pipe(Effect.flatMap(Effect.log));
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

const NullDatabaseSession: RefValue<DatabaseSession<unknown, LibsqlError>> = {
  read: () => Effect.dieMessage('TransactionBoundary#begin not called!'),
  write: () => Effect.dieMessage('TransactionBoundary#begin not called!'),
  queryBuilder: coldInstance
};

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
