import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  Transaction,
  type CompiledQuery
} from 'kysely';
import {
  Effect,
  FiberRef,
  Scope,
  Data,
  Match,
  PubSub,
  Option,
  pipe,
  Context,
  Layer,
  Queue
} from 'effect';
import { ReadonlyQuery, type DatabaseSession } from '@hex-effect/infra';
import { Client, InValue, LibsqlError } from '@libsql/client';
import { LibsqlDialect } from './libsql-dialect.js';
import { nanoid } from 'nanoid';

export { LibsqlDialect };

export type Modes = Exclude<TransactionSession['_tag'], 'None'>;

export type TransactionalBoundary = {
  begin(mode: Modes): Effect.Effect<void, never, Scope.Scope>;
  commit(): Effect.Effect<void, never>;
  rollback(): Effect.Effect<void>;
};

export type DatabaseConnection<DB> = {
  db: Kysely<DB>;
  client: Client;
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
}>;

const { Batched, Serialized, $match, $is } = Data.taggedEnum<TransactionSession>();

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

export const makeTransactionalBoundary2 = <DB, S>(
  connection: DatabaseConnection<DB>,
  session: DatabaseSession<DB, LibsqlError>,
  tag: Context.Tag<S, TransactionalBoundary>
) => {
  const { client, db } = connection;
  let maybeTransactionSession = Option.none<FiberRef.FiberRef<TransactionSession>>();

  class TransactionEvents extends Context.Tag(nanoid())<
    TransactionEvents,
    PubSub.PubSub<keyof TransactionalBoundary>
  >() {
    public static live = Layer.effect(
      TransactionEvents,
      PubSub.sliding<keyof TransactionalBoundary>(10)
    );
  }

  const EventPublishingDaemon = Layer.scopedDiscard(
    Effect.gen(function* () {
      const pub = yield* TransactionEvents;
      const dequeue = yield* PubSub.subscribe(pub);
      yield* Queue.take(dequeue)
        .pipe(
          Effect.map((a) => a === 'commit'),
          Effect.if({
            onTrue: () => Effect.log('supppp!'),
            onFalse: () => Effect.void
          }),
          Effect.forever
        )
        .pipe(Effect.forkScoped);
    })
  );

  const boundaryEffect = TransactionEvents.pipe(
    Effect.map(
      (pub): TransactionalBoundary => ({
        begin: (mode) =>
          Match.value(mode)
            .pipe(
              Match.when('Batched', () =>
                Effect.gen(function* () {
                  const ref = yield* FiberRef.make<TransactionSession>(Batched({ writes: [] }));
                  maybeTransactionSession = Option.some(ref);
                  yield* FiberRef.set(session, createBatchedDatabaseSession(db, ref));
                })
              ),
              Match.when('Serialized', () =>
                Effect.gen(function* () {
                  const tx = yield* initiateTransaction(db);
                  const ref = yield* FiberRef.make<TransactionSession>(Serialized({ tx }));
                  maybeTransactionSession = Option.some(ref);
                  yield* FiberRef.set(session, createDatabaseSession(tx.tx));
                })
              ),
              Match.exhaustive
            )
            .pipe(Effect.tap(() => PubSub.publish(pub, 'begin'))),

        commit: () =>
          // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
          FiberRef.get(Option.getOrThrow(maybeTransactionSession)).pipe(
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
            ),
            Effect.tap(() => PubSub.publish(pub, 'commit'))
          ),
        rollback: () =>
          pipe(
            Option.getOrThrow(maybeTransactionSession),
            (ref) => Effect.zip(FiberRef.get(ref), Effect.succeed(ref)),
            Effect.flatMap(([transactionSession, ref]) =>
              $match({
                Serialized: ({ tx }) => tx.rollback,
                Batched: (a) => FiberRef.set(ref, { ...a, writes: [] })
              })(transactionSession)
            ),
            Effect.tap(() => PubSub.publish(pub, 'rollback'))
          )
      })
    )
  );

  const layer = Layer.effect(tag, boundaryEffect).pipe(
    Layer.provide(EventPublishingDaemon),
    Layer.provide(TransactionEvents.live)
  );

  return layer;
};

export const makeTransactionalBoundary = <DB>(
  connection: DatabaseConnection<DB>,
  session: DatabaseSession<DB, LibsqlError>,
  pub: PubSub.PubSub<keyof TransactionalBoundary>
) => {
  const { client, db } = connection;
  let maybeTransactionSession = Option.none<FiberRef.FiberRef<TransactionSession>>();

  const boundary: TransactionalBoundary = {
    begin: (mode) =>
      Match.value(mode)
        .pipe(
          Match.when('Batched', () =>
            Effect.gen(function* () {
              const ref = yield* FiberRef.make<TransactionSession>(Batched({ writes: [] }));
              maybeTransactionSession = Option.some(ref);
              yield* FiberRef.set(session, createBatchedDatabaseSession(db, ref));
            })
          ),
          Match.when('Serialized', () =>
            Effect.gen(function* () {
              const tx = yield* initiateTransaction(db);
              const ref = yield* FiberRef.make<TransactionSession>(Serialized({ tx }));
              maybeTransactionSession = Option.some(ref);
              yield* FiberRef.set(session, createDatabaseSession(tx.tx));
            })
          ),
          Match.exhaustive
        )
        .pipe(Effect.tap(() => PubSub.publish(pub, 'begin'))),
    commit: () =>
      // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
      FiberRef.get(Option.getOrThrow(maybeTransactionSession)).pipe(
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
        ),
        Effect.tap(() => PubSub.publish(pub, 'commit'))
      ),
    rollback: () =>
      pipe(
        Option.getOrThrow(maybeTransactionSession),
        (ref) => Effect.zip(FiberRef.get(ref), Effect.succeed(ref)),
        Effect.flatMap(([transactionSession, ref]) =>
          $match({
            Serialized: ({ tx }) => tx.rollback,
            Batched: (a) => FiberRef.set(ref, { ...a, writes: [] })
          })(transactionSession)
        ),
        Effect.tap(() => PubSub.publish(pub, 'rollback'))
      )
  };

  return boundary;
};

const coldInstance = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

type FiberRefValue<T> = T extends FiberRef.FiberRef<infer V> ? V : never;

export const createDatabaseSession = <DB>(
  db: Kysely<DB>
): FiberRefValue<DatabaseSession<DB, LibsqlError>> => {
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
  transactionSession: FiberRef.FiberRef<TransactionSession>
): FiberRefValue<DatabaseSession<DB, LibsqlError>> => {
  return {
    ...createDatabaseSession(hotInstance),
    write(op) {
      return FiberRef.update(transactionSession, (a) =>
        $is('Batched')(a) ? { ...a, writes: [...a.writes, op] } : a
      );
    }
  };
};
