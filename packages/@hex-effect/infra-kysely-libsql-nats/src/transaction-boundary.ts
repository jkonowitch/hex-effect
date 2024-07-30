import { Kysely, Transaction, type CompiledQuery } from 'kysely';
import {
  Effect,
  FiberRef,
  Data,
  Match,
  PubSub,
  Option,
  pipe,
  Context,
  Layer,
  Scope,
  Fiber,
  Queue
} from 'effect';
import {
  DomainEventPublisher,
  type TransactionalBoundary as ITransactionalBoundary
} from '@hex-effect/core';
import { type InValue } from '@libsql/client';
import { DatabaseConnection, DatabaseSession, TransactionEvents } from './service-definitions.js';

type LibsqlTransactionalBoundary = ITransactionalBoundary<Modes>;

export class TransactionalBoundary extends Context.Tag('TransactionalBoundary')<
  TransactionalBoundary,
  LibsqlTransactionalBoundary
>() {
  public static live = Layer.effect(
    TransactionalBoundary,
    Effect.gen(function* () {
      const { client, db } = yield* DatabaseConnection;
      let maybeTransactionSession = Option.none<FiberRef.FiberRef<TransactionSession>>();
      const pub = yield* TransactionEvents;
      const session = yield* DatabaseSession;
      const boundary: LibsqlTransactionalBoundary = {
        begin: (mode) =>
          Match.value(mode)
            .pipe(
              Match.when('Batched', () =>
                Effect.gen(function* () {
                  const ref = yield* FiberRef.make<TransactionSession>(Batched({ writes: [] }));
                  maybeTransactionSession = Option.some(ref);
                  yield* FiberRef.getAndUpdate(session, (current) => ({
                    ...current,
                    write(op) {
                      return FiberRef.update(ref, (a) =>
                        $is('Batched')(a) ? { ...a, writes: [...a.writes, op] } : a
                      );
                    }
                  }));
                })
              ),
              Match.when('Serialized', () =>
                Effect.gen(function* () {
                  const tx = yield* initiateTransaction(db);
                  const ref = yield* FiberRef.make<TransactionSession>(Serialized({ tx }));
                  maybeTransactionSession = Option.some(ref);
                  yield* FiberRef.set(session, DatabaseSession.createDatabaseSession(tx.tx));
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
    })
  );
}
const storeDomainEvents = Effect.gen(function* () {
  const pub = yield* DomainEventPublisher;
  // const store = yield* EventStore;
  const dequeue = yield* PubSub.subscribe(pub);

  yield* Queue.take(dequeue).pipe(Effect.andThen(Effect.log), Effect.forever);
});

export function withTransactionalBoundary(mode: Modes = 'Batched') {
  return <A, E, R>(
    useCase: Effect.Effect<A, E, R>
  ): Effect.Effect<
    A,
    E,
    TransactionalBoundary | Exclude<Exclude<R, DomainEventPublisher>, Scope.Scope>
  > =>
    Effect.gen(function* () {
      const fiber = yield* Effect.gen(function* () {
        const tx = yield* TransactionalBoundary;
        yield* tx.begin(mode);
        const eventStoreProcess = yield* storeDomainEvents.pipe(Effect.fork);
        const result = yield* useCase.pipe(Effect.tapError(tx.rollback));
        yield* Fiber.interrupt(eventStoreProcess);
        yield* tx.commit();
        return result;
      }).pipe(DomainEventPublisher.live, Effect.scoped, Effect.fork);

      const exit = yield* Fiber.await(fiber);
      return yield* exit;
    });
}

type Modes = Exclude<TransactionSession['_tag'], 'None'>;

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
