import { Config, Context, Effect, identity, Layer, String } from 'effect';
import { type Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { createClient, type Config as LibsqlClientConfig } from '@libsql/client';
import { LibsqlClient } from '@effect/sql-libsql';
import { DataIntegrityError, InfrastructureError } from '@hex-effect/core';

class _WriteExecutor extends Context.Tag('@hex-effect/_WriteExecutor')<
  _WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {}

export const LibsqlConfig = Context.GenericTag<{ config: Config.Config.Wrap<LibsqlClientConfig> }>(
  '@hex/effect/LibsqlClientConfig'
);

export class LibsqlSdk extends Effect.Service<LibsqlSdk>()('@hex-effect/LibsqlSdk', {
  scoped: Effect.gen(function* () {
    const config = yield* LibsqlConfig.pipe(Effect.flatMap(({ config }) => Config.unwrap(config)));
    const sdk = yield* Effect.acquireRelease(
      Effect.sync(() => createClient(config)),
      (a) => Effect.sync(() => a.close())
    );

    return { sdk };
  }),
  accessors: true
}) {}

export const LibsqlClientLive = Layer.unwrapEffect(
  LibsqlSdk.pipe(
    Effect.andThen(({ sdk }) =>
      LibsqlClient.layer({
        liveClient: Config.succeed(sdk),
        transformQueryNames: Config.succeed(String.camelToSnake),
        transformResultNames: Config.succeed(String.snakeToCamel)
      })
    )
  )
);

export class WriteStatement extends Context.Tag('WriteStatement')<
  WriteStatement,
  (
    stm: Statement.Statement<unknown>
  ) => Effect.Effect<void, InfrastructureError | DataIntegrityError>
>() {
  public static live = Layer.succeed(WriteStatement, (stm) =>
    Effect.serviceOption(_WriteExecutor)
      .pipe(
        Effect.map((_) => (_._tag === 'None' ? identity : _.value)),
        Effect.andThen((wr) => wr(stm))
      )
      // TODO: distinguish between data integrity errors, and other internal/external InfraErrors (like malformed sql, server comms issues, etc.)
      .pipe(Effect.mapError((e) => new InfrastructureError({ cause: e })))
  );

  public static withExecutor = <A, E, R>(
    e: Effect.Effect<A, E, R>,
    service: typeof _WriteExecutor.Service
  ) => Effect.provideService(e, _WriteExecutor, service);
}
