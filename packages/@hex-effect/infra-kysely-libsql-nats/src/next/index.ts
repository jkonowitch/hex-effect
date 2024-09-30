import { IsolationLevel, WithTransaction } from '@hex-effect/core';
import { Context, Effect, FiberRef, Layer, Ref } from 'effect';
import { SqlClient, Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';

class WriteThing extends Context.Tag('WriteThing')<
  WriteThing,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteThing, (stm) => stm);
}

const WTLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const r = sql<{ hello: boolean }>`hello`;
    r.compile();
    return <A, E, R>(eff: Effect.Effect<A, E, R>, isolationLevel: IsolationLevel) => {
      if (isolationLevel === IsolationLevel.Batched) {
        const prog = Effect.withFiberRuntime<A, E, R>((fiber) =>
          Effect.gen(function* () {
            const ctx = fiber.getFiberRef(FiberRef.currentContext);
            const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
            const q = yield* Effect.locally(
              eff,
              FiberRef.currentContext,
              Context.add(ctx, WriteThing, (stm) => Ref.update(ref, (a) => [...a, stm]))
            );
            return q;
          })
        );
      }

      return sql.withTransaction(eff).pipe(Effect.orDie);
    };
  })
);
