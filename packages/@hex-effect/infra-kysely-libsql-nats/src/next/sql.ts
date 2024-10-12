import { Config, Context, Effect, identity, Layer } from 'effect';
import { type Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { createClient } from '@libsql/client';

class _WriteExecutor extends Context.Tag('@hex-effect/_WriteExecutor')<
  _WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {}

export class LibsqlSdk extends Effect.Service<LibsqlSdk>()('@hex-effect/LibsqlSdk', {
  scoped: Effect.gen(function* () {
    const url = yield* Config.string('TURSO_URL');
    const sdk = yield* Effect.acquireRelease(
      Effect.sync(() => createClient({ url })),
      (a) => Effect.sync(() => a.close())
    );

    return { sdk };
  }),
  accessors: true
}) {}

export class WriteStatement extends Context.Tag('WriteStatement')<
  WriteStatement,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteStatement, (stm) =>
    Effect.serviceOption(_WriteExecutor).pipe(
      Effect.map((_) => (_._tag === 'None' ? identity : _.value)),
      Effect.andThen((wr) => wr(stm))
    )
  );

  public static withExecutor = <A, E, R>(
    e: Effect.Effect<A, E, R>,
    service: typeof _WriteExecutor.Service
  ) => Effect.provideService(e, _WriteExecutor, service);
}
