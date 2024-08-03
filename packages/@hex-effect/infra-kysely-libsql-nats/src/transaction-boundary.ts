import { Kysely, Transaction, type CompiledQuery } from 'kysely';
import { Effect, FiberRef, Data, Match, Layer, Ref, PubSub, Stream, FiberSet, Fiber } from 'effect';
import {
  DomainEventPublisher,
  IsolationLevel,
  TransactionalBoundary,
  TransactionalBoundaryProvider,
  type ITransactionalBoundary
} from '@hex-effect/core';
import { type InValue } from '@libsql/client';
import {
  DatabaseConnection,
  DatabaseSession,
  EventStore,
  TransactionEvents
} from './service-definitions.js';
import { Serializable } from '@effect/schema';

// type LibsqlTransactionalBoundary = ITransactionalBoundary<Modes>;

export const shmee = Layer.effect(
  TransactionalBoundaryProvider,
  Effect.gen(function* () {
    const { client, db } = yield* DatabaseConnection;
    const pub = yield* TransactionEvents;
    const session = yield* DatabaseSession;
    const store = yield* EventStore;

    return {
      provide: Effect.gen(function* () {
        yield* Effect.log('kralf');
        return Layer.effect(
          TransactionalBoundary,
          Effect.gen(function* () {
            const pub = yield* DomainEventPublisher;
            const ref = yield* Ref.make<TransactionSession>(None());

            const boundary: ITransactionalBoundary = {
              begin: (mode) =>
                Effect.gen(function* () {
                  yield* Match.value(mode).pipe(
                    Match.when(IsolationLevel.Batched, () =>
                      Effect.gen(function* () {
                        yield* Ref.set(ref, Batched({ writes: [] }));
                        yield* FiberRef.update(session, (current) => ({
                          ...current,
                          write(op) {
                            return Ref.update(ref, (s) =>
                              $is('Batched')(s) ? { ...s, writes: [...s.writes, op] } : s
                            );
                          }
                        }));
                      })
                    ),
                    Match.when(IsolationLevel.Serializable, () =>
                      Effect.gen(function* () {
                        const tx = yield* initiateTransaction(db);
                        yield* Ref.set(ref, Serialized({ tx }));
                        yield* FiberRef.set(session, DatabaseSession.createDatabaseSession(tx.tx));
                      })
                    ),
                    Match.orElse(() => Effect.dieMessage('Unsupported mode'))
                  );

                  const sub = yield* PubSub.subscribe(pub);

                  yield* Stream.fromQueue(sub).pipe(
                    Stream.tap((e) => Serializable.serialize(e).pipe(Effect.andThen(store.save))),
                    Stream.tap(Effect.log),
                    Stream.runDrain,
                    Effect.forkScoped
                  );

                  yield* Effect.yieldNow();
                }),

              commit: () =>
                Effect.gen(function* () {
                  yield* Fiber.await(yield* pub.shutdown.pipe(Effect.fork));
                  yield* Effect.log('committing');
                  const txSession = yield* Ref.get(ref);

                  yield* $match({
                    Batched: ({ writes }) =>
                      Effect.promise(() =>
                        client.batch(
                          writes.map((w) => ({
                            args: w.parameters as Array<InValue>,
                            sql: w.sql
                          }))
                        )
                      ),
                    Serialized: () => Effect.log('to implement'),
                    None: () => Effect.dieMessage('kralf')
                  })(txSession);
                }),
              rollback: () =>
                Ref.get(ref).pipe(
                  Effect.flatMap(
                    $match({
                      Batched: () => Ref.set(ref, Batched({ writes: [] })),
                      Serialized: ({ tx }) => tx.rollback,
                      None: () => Effect.dieMessage('')
                    })
                  )
                )
            };

            return boundary;
          })
        ).pipe(Layer.provideMerge(DomainEventPublisher.live));
      })
    };
  })
);

type DBTX = {
  commit: Effect.Effect<void>;
  rollback: Effect.Effect<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: Transaction<any>;
};

type TransactionSession = Data.TaggedEnum<{
  Batched: { writes: Array<CompiledQuery<unknown>> };
  Serialized: { tx: DBTX };
  None: object;
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
