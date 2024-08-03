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
        return Layer.scoped(
          TransactionalBoundary,
          Effect.gen(function* () {
            const pub = yield* DomainEventPublisher;
            const ref = yield* Ref.make<TransactionSession>(None());
            const fibers = yield* FiberSet.make();

            const boundary: ITransactionalBoundary = {
              begin: (mode) =>
                Match.value(mode)
                  .pipe(
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
                  )
                  .pipe(
                    Effect.tap(() =>
                      Effect.gen(function* () {
                        const sub = yield* PubSub.subscribe(pub);

                        yield* FiberSet.run(
                          fibers,
                          Stream.fromQueue(sub).pipe(
                            Stream.tap((e) =>
                              Serializable.serialize(e).pipe(Effect.andThen(store.save))
                            ),
                            Stream.runDrain,
                            Effect.forkScoped
                          )
                        );

                        yield* Effect.yieldNow();
                      })
                    )
                  ),
              commit: () =>
                Effect.gen(function* () {
                  yield* Fiber.await(yield* Fiber.interruptAll(fibers).pipe(Effect.fork));
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

// export class TransactionalBoundary extends Context.Tag('TransactionalBoundary')<
//   TransactionalBoundary,
//   LibsqlTransactionalBoundary
// >() {
//   public static live = Layer.effect(
//     TransactionalBoundary,
//     Effect.gen(function* () {
//       const { client, db } = yield* DatabaseConnection;
//       let maybeTransactionSession = Option.none<FiberRef.FiberRef<TransactionSession>>();
//       const pub = yield* TransactionEvents;
//       const session = yield* DatabaseSession;
//       const boundary: LibsqlTransactionalBoundary = {
//         begin: (mode) =>
//           Match.value(mode)
//             .pipe(
//               Match.when('Batched', () =>
//                 Effect.gen(function* () {
//                   const ref = yield* FiberRef.make<TransactionSession>(Batched({ writes: [] }));
//                   maybeTransactionSession = Option.some(ref);
//                   yield* FiberRef.getAndUpdate(session, (current) => ({
//                     ...current,
//                     write(op) {
//                       return FiberRef.update(ref, (a) => {
//                         if ($is('Batched')(a)) {
//                           a.writes.push(op);
//                         }
//                         return a;
//                       });
//                     }
//                   }));
//                 })
//               ),
//               Match.when('Serialized', () =>
//                 Effect.gen(function* () {
//                   const tx = yield* initiateTransaction(db);
//                   const ref = yield* FiberRef.make<TransactionSession>(Serialized({ tx }));
//                   maybeTransactionSession = Option.some(ref);
//                   yield* FiberRef.set(session, DatabaseSession.createDatabaseSession(tx.tx));
//                 })
//               ),
//               Match.exhaustive
//             )
//             .pipe(Effect.tap(() => PubSub.publish(pub, 'begin'))),
//         commit: () =>
//           // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
//           FiberRef.get(Option.getOrThrow(maybeTransactionSession)).pipe(
//             Effect.flatMap(
//               $match({
//                 Serialized: ({ tx }) => tx.commit,
//                 Batched: ({ writes }) =>
//                   Effect.log(writes.map((w) => w.sql)).pipe(
//                     Effect.andThen(
//                       Effect.promise(() =>
//                         client.batch(
//                           writes.map((w) => ({ args: w.parameters as Array<InValue>, sql: w.sql }))
//                         )
//                       )
//                     ),
//                     Effect.tap((e) =>
//                       Effect.log(
//                         'ok',
//                         writes.map((w) => w.sql)
//                       )
//                     )
//                   )
//               })
//             ),
//             Effect.tap(() => PubSub.publish(pub, 'commit'))
//           ),
//         rollback: () =>
//           pipe(
//             Option.getOrThrow(maybeTransactionSession),
//             (ref) => Effect.zip(FiberRef.get(ref), Effect.succeed(ref)),
//             Effect.flatMap(([transactionSession, ref]) =>
//               $match({
//                 Serialized: ({ tx }) => tx.rollback,
//                 Batched: (a) => FiberRef.set(ref, { ...a, writes: [] })
//               })(transactionSession)
//             ),
//             Effect.tap(() => PubSub.publish(pub, 'rollback'))
//           )
//       };

//       return boundary;
//     })
//   );
// }
// export function withTransactionalBoundary(mode: Modes = 'Batched') {
//   return <A, E, R>(
//     useCase: Effect.Effect<A, E, R>
//   ): Effect.Effect<
//     A,
//     E,
//     TransactionalBoundary | Exclude<Exclude<R, DomainEventPublisher>, Scope.Scope>
//   > =>
//     Effect.gen(function* () {
//       const fiber = yield* Effect.gen(function* () {
//         const tx = yield* TransactionalBoundary;

//         yield* tx.begin(mode);

//         // const store = yield* EventStore;
//         // const pub = yield* DomainEventPublisher;
//         // const sub = yield* PubSub.subscribe(pub);
//         // yield* Stream.fromQueue(sub).pipe(
//         //   Stream.tap((e) => Serializable.serialize(e).pipe(Effect.tap(store.save))),
//         //   Stream.runDrain,
//         //   Effect.fork
//         // );

//         const result = yield* useCase.pipe(Effect.tapError(tx.rollback));
//         yield* tx.commit();
//         return result;
//       }).pipe(DomainEventPublisher.live, Effect.scoped, Effect.fork);

//       const exit = yield* Fiber.await(fiber);
//       return yield* exit;
//     });
// }

// type Modes = Exclude<TransactionSession['_tag'], 'None'>;

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
