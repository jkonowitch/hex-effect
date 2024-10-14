import {
  IsolationLevel,
  TransactionError,
  WithTransaction,
  type EncodableEventBase
} from '@hex-effect/core';
import { Context, Effect, Layer, PubSub, Ref } from 'effect';
import { type Statement } from '@effect/sql';
import { LibsqlClient } from '@effect/sql-libsql';
import { type InValue } from '@libsql/client';
import { isTagged } from 'effect/Predicate';
import { LibsqlClientLive, LibsqlSdk, WriteStatement } from './sql.js';
import { EventStoreLive, SaveEvents } from './event-store.js';

const isTaggedError = (e: unknown) => isTagged(e, 'SqlError') || isTagged(e, 'ParseError');

export class UseCaseCommit extends Context.Tag('@hex-effect/UseCaseCommit')<
  UseCaseCommit,
  PubSub.PubSub<void>
>() {
  public static live = Layer.effect(UseCaseCommit, PubSub.sliding<void>(10));
}

export const WithTransactionLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;
    const sdk = yield* LibsqlSdk.sdk;

    const { save } = yield* SaveEvents;
    const pub = yield* UseCaseCommit;
    return <E, R, A extends EncodableEventBase>(
      useCase: Effect.Effect<A[], E, R>,
      isolationLevel: IsolationLevel
    ) => {
      const useCaseWithEventStorage = useCase.pipe(
        Effect.tap(save),
        Effect.mapError((e) => (isTaggedError(e) ? new TransactionError({ cause: e }) : e))
      );

      let program: Effect.Effect<A[], E | TransactionError, R>;

      if (isolationLevel === IsolationLevel.Batched) {
        program = Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* WriteStatement.withExecutor(useCaseWithEventStorage, (stm) =>
            Ref.update(ref, (a) => [...a, stm])
          );
          const writes = yield* Ref.get(ref);
          yield* Effect.tryPromise({
            try: () =>
              sdk.batch(
                writes.map((w) => {
                  const [sql, args] = w.compile();
                  return {
                    args: args as Array<InValue>,
                    sql: sql
                  };
                })
              ),
            catch: (e) => new TransactionError({ cause: e })
          });
          return results;
        });
      } else if (isolationLevel === IsolationLevel.Serializable) {
        program = useCaseWithEventStorage.pipe(
          client.withTransaction,
          Effect.mapError((e) => (isTaggedError(e) ? new TransactionError({ cause: e }) : e))
        );
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }

      return program.pipe(Effect.tap(() => pub.publish()));
    };
  })
).pipe(
  Layer.provide(EventStoreLive),
  Layer.provideMerge(WriteStatement.live),
  Layer.provide(UseCaseCommit.live),
  Layer.provideMerge(LibsqlClientLive)
);
