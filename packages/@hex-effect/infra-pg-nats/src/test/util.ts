import { Effect, Config, Context, Layer, Redacted, Schema } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { SqlClient, SqlError } from '@effect/sql';
import { makeDomainEvent, UUIDGenerator } from '@hex-effect/core';
import { nanoid } from 'nanoid';
import { PgConfig } from '../sql.js';
import { NatsClient, NatsConfig, WriteStatement } from '@hex-effect/infra-nats';

export class PgContainer extends Context.Tag('test/PgContainer')<
  PgContainer,
  StartedTestContainer
>() {
  private static ContainerLive = Layer.scoped(
    this,
    Effect.acquireRelease(
      Effect.promise(() =>
        new GenericContainer('postgres:16-alpine')
          .withExposedPorts(5432)
          .withEnvironment({
            POSTGRES_DB: 'hexeffect',
            POSTGRES_USER: 'hexeffect',
            POSTGRES_PASSWORD: 'hexeffect'
          })
          .withWaitStrategy(Wait.forListeningPorts())
          .start()
      ),
      (container) => Effect.promise(() => container.stop())
    )
  );

  public static ConfigLive = Layer.effect(
    PgConfig,
    PgContainer.pipe(
      Effect.andThen((container) => ({
        config: Config.map(
          Config.succeed(
            `postgresql://hexeffect:hexeffect@${container.getHost()}:${container.getMappedPort(5432)}/hexeffect`
          ),
          (url) => ({ url: Redacted.make(url) })
        )
      }))
    )
  ).pipe(Layer.provide(this.ContainerLive));
}

export class NatsContainer extends Context.Tag('test/NatsContainer')<
  NatsContainer,
  StartedTestContainer
>() {
  private static Live = Layer.scoped(
    this,
    Effect.acquireRelease(
      Effect.promise(() =>
        new GenericContainer('nats:latest')
          .withCommand(['-js'])
          .withExposedPorts(4222)
          .withWaitStrategy(Wait.forLogMessage(/.*Server is ready.*/))
          .start()
      ),
      (container) => Effect.promise(() => container.stop())
    )
  );

  static ConfigLive = NatsClient.layer.pipe(
    Layer.provideMerge(
      Layer.unwrapEffect(
        Effect.gen(function* () {
          const container = yield* NatsContainer;
          return Layer.succeed(NatsConfig, {
            config: Config.map(
              Config.succeed(`nats://${container.getHost()}:${container.getMappedPort(4222)}`),
              (servers) => ({ servers })
            ),
            appNamespace: Config.succeed('KRALF')
          });
        })
      )
    ),
    Layer.provide(this.Live)
  );
}

export const resetDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`TRUNCATE TABLE people`;
  yield* sql`DELETE FROM hex_effect_events`;
}).pipe(Effect.orDie);

export const PersonId = Schema.NonEmptyTrimmedString.pipe(Schema.brand('PersonId'));

export const PersonCreatedEvent = makeDomainEvent(
  { _tag: 'PersonCreatedEvent', _context: '@test' },
  { id: PersonId }
);

export const addPerson = (name: string) =>
  Effect.gen(function* () {
    const id = PersonId.make(nanoid());
    const sql = yield* SqlClient.SqlClient;
    const w = yield* WriteStatement;
    yield* w(sql`INSERT INTO people ${sql.insert({ id, name })}`);
    return [yield* PersonCreatedEvent.make({ id })] as const;
  }).pipe(Effect.provide(UUIDGenerator.Default));

export const Migrations = Layer.scopedDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const migrate = sql`
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL
      )
    `;
    yield* Effect.acquireRelease(migrate, () => resetDatabase);
  })
) as Layer.Layer<never, SqlError.SqlError, SqlClient.SqlClient>;
