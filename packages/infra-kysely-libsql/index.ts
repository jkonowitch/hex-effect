import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  Transaction,
  type CompiledQuery
} from 'kysely';
import { Effect, Ref, Scope, Data, Match } from 'effect';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';
import { Client, InValue, LibsqlError } from '@libsql/client';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: Transaction<any>;
};

type TransactionSession = Data.TaggedEnum<{
  Batched: { writes: ReadonlyArray<CompiledQuery<unknown>> };
  Serialized: { tx: DBTX };
  // eslint-disable-next-line @typescript-eslint/ban-types
  None: {};
}>;

const { Batched, Serialized, None, $match, $is } = Data.taggedEnum<TransactionSession>();

const initiateTransaction = <DB>(db: Kysely<DB>) =>
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

class RollbackError extends Data.TaggedError('RollbackError') {
  static isRollback(e: unknown): e is RollbackError {
    return e instanceof this && e._tag === 'RollbackError';
  }
}

export const makeTransactionalBoundary = <DB>(
  connection: { client: Client; db: Kysely<DB> },
  session: DatabaseSession<DB, LibsqlError>
) =>
  Effect.gen(function* () {
    const { client, db } = connection;
    const transactionSession = yield* Ref.make<TransactionSession>(None());

    const boundary: TransactionalBoundary = {
      begin: (mode) =>
        Match.value(mode).pipe(
          Match.when('Batched', () =>
            Effect.gen(function* () {
              yield* Ref.set(transactionSession, Batched({ writes: [] }));
              yield* Ref.set(session, createBatchedDatabaseSession(db, transactionSession));
            })
          ),
          Match.when('Serialized', () =>
            Effect.gen(function* () {
              const tx = yield* initiateTransaction(db);
              yield* Ref.set(transactionSession, Serialized({ tx }));
              yield* Ref.set(session, createDatabaseSession(tx.tx));
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

export const createDatabaseSession = <DB>(
  db: Kysely<DB>
): RefValue<DatabaseSession<DB, LibsqlError>> => {
  return {
    read<Q>(op: ReadonlyQuery<CompiledQuery<Q>>) {
      return Effect.promise(() => db.executeQuery(op));
    },
    write(op) {
      return Effect.promise(() => db.executeQuery(op));
    },
    queryBuilder: coldInstance as Kysely<DB>
  };
};

const createBatchedDatabaseSession = <DB>(
  hotInstance: Kysely<DB>,
  transactionSession: Ref.Ref<TransactionSession>
): RefValue<DatabaseSession<DB, LibsqlError>> => {
  return {
    ...createDatabaseSession(hotInstance),
    write(op) {
      return Ref.update(transactionSession, (a) =>
        $is('Batched')(a) ? { ...a, writes: [...a.writes, op] } : a
      );
    }
  };
};
