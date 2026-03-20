import { Config, Context, Effect, Layer, String } from 'effect';
import { PgClient } from '@effect/sql-pg';

export const PgConfig = Context.GenericTag<{ config: Config.Config.Wrap<PgClient.PgClientConfig> }>(
  '@hex-effect/PgConfig'
);

export const PgClientLive = Layer.unwrapEffect(
  PgConfig.pipe(
    Effect.flatMap(({ config }) => Config.unwrap(config)),
    Effect.map((config) =>
      PgClient.layer({
        ...config,
        transformQueryNames: String.camelToSnake,
        transformResultNames: String.snakeToCamel
      })
    )
  )
);
