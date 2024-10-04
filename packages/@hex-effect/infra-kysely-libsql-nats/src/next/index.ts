import { IsolationLevel, WithTransaction } from '@hex-effect/core';
import { Context, Effect, Layer, Ref } from 'effect';
import type { Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from './libsql-client/index.js';
import type { InValue } from '@libsql/client';

export class WriteThing extends Context.Tag('WriteThing')<
  WriteThing,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteThing, (stm) => stm);
}
// https://effect.website/play#7382a05e89d6
export const WTLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;

    return <A, E, R>(eff: Effect.Effect<A, E, R>, isolationLevel: IsolationLevel) => {
      if (isolationLevel === IsolationLevel.Batched) {
        const prog = Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* Effect.provideService(eff, WriteThing, (stm) =>
            Ref.update(ref, (a) => [...a, stm])
          );
          const writes = yield* Ref.get(ref);
          yield* Effect.promise(() =>
            client.sdk.batch(
              writes.map((w) => {
                const [sql, args] = w.compile();
                return {
                  args: args as Array<InValue>,
                  sql: sql
                };
              })
            )
          );
          return results;
        });

        return prog;
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }
    };
  })
);
