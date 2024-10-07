import {
  IsolationLevel,
  TransactionError,
  WithTransaction,
  type EventBaseType
} from '@hex-effect/core';
import { Context, Effect, Layer, Option, Ref } from 'effect';
import type { Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from './libsql-client/index.js';
import type { InValue } from '@libsql/client';

class WriteExecutor extends Context.Tag('WriteExecutor')<
  WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(this, (stm) => stm);
}

export class WriteStatement extends Context.Tag('WriteStatement')<
  WriteStatement,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteStatement, (stm) =>
    Effect.serviceOption(WriteExecutor).pipe(
      Effect.map(Option.getOrThrowWith(() => new Error('WriteExecutor not initialized'))),
      Effect.andThen((wr) => wr(stm))
    )
  ).pipe(Layer.provideMerge(WriteExecutor.live));
}

export const WTLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;

    return <A extends EventBaseType[], E, R>(
      eff: Effect.Effect<A, E, R>,
      isolationLevel: IsolationLevel
    ) => {
      if (isolationLevel === IsolationLevel.Batched) {
        const prog = Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* Effect.provideService(eff, WriteExecutor, (stm) =>
            Ref.update(ref, (a) => [...a, stm])
          );
          const writes = yield* Ref.get(ref);
          yield* Effect.tryPromise({
            try: () =>
              client.sdk.batch(
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

        return prog;
      } else if (isolationLevel === IsolationLevel.Serializable) {
        return eff.pipe(
          client.withTransaction,
          Effect.catchTag('SqlError', (e) => Effect.fail(new TransactionError({ cause: e })))
        );
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }
    };
  })
);
