import { Effect, Config, Context, Layer, Struct } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { LibsqlConfig, LibsqlSdk } from '../sql.js';
import { NatsClient } from '../messaging.js';
import { LibsqlClient } from '@effect/sql-libsql';

export class LibsqlContainer extends Context.Tag('test/LibsqlContainer')<
  LibsqlContainer,
  StartedTestContainer
>() {
  private static ContainerLive = Layer.scoped(
    this,
    Effect.acquireRelease(
      Effect.promise(() =>
        new GenericContainer('ghcr.io/tursodatabase/libsql-server:main')
          .withExposedPorts(8080)
          .withEnvironment({ SQLD_NODE: 'primary' })
          .withCommand(['sqld', '--no-welcome', '--http-listen-addr', '0.0.0.0:8080'])
          .start()
      ),
      (container) => Effect.promise(() => container.stop())
    )
  );

  public static ConfigLive = Layer.effect(
    LibsqlConfig,
    LibsqlContainer.pipe(
      Effect.andThen((container) => ({
        config: {
          url: Config.succeed(`http://localhost:${container.getMappedPort(8080)}`)
        }
      }))
    )
  ).pipe(Layer.provide(this.ContainerLive));
}

export class NatsContainer extends Context.Tag('test/NatsContainer')<
  NatsContainer,
  StartedTestContainer
>() {
  static Live = Layer.scoped(
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

  static ClientLive = Layer.unwrapEffect(
    Effect.gen(function* () {
      const container = yield* NatsContainer;
      return NatsClient.layer({
        servers: Config.succeed(`nats://localhost:${container.getMappedPort(4222)}`)
      });
    })
  ).pipe(Layer.provide(this.Live));
}

export const resetDatabase = Effect.gen(function* () {
  const sql = yield* LibsqlClient.LibsqlClient;
  const sdk = yield* LibsqlSdk.sdk;

  const dropTableCmds = yield* sql<{
    cmd: string;
  }>`SELECT 'DROP TABLE ' || name || ';' as cmd FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'hex_effect_events';`;
  const dropTriggerCmds = yield* sql<{
    cmd: string;
  }>`SELECT 'DROP TRIGGER IF EXISTS ' || name || ';' as cmd FROM sqlite_master WHERE type='trigger';`;
  const dropIndexCmds = yield* sql<{
    cmd: string;
  }>`SELECT 'DROP INDEX IF EXISTS ' || name || ';'as cmd FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'hex_effect_%';`;
  yield* Effect.promise(() =>
    sdk.migrate([
      `PRAGMA foreign_keys=OFF;`,
      ...dropTriggerCmds.map(Struct.get('cmd')),
      ...dropIndexCmds.map(Struct.get('cmd')),
      ...dropTableCmds.map(Struct.get('cmd')),
      `DELETE FROM hex_effect_events`,
      `PRAGMA foreign_keys=ON;`
    ])
  );
}).pipe(Effect.orDie);
