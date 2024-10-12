import { Effect, Config, Context, Layer, String, ConfigProvider } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { LibsqlClient } from '@effect/sql-libsql';
import { LibsqlSdk } from '../sql.js';
import { NatsClient } from '../messaging.js';

export class LibsqlContainer extends Context.Tag('test/LibsqlContainer')<
  LibsqlContainer,
  StartedTestContainer
>() {
  static ContainerLive = Layer.scoped(
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

  private static ClientLive = Layer.unwrapEffect(
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

  private static ConfigLive = Layer.unwrapEffect(
    LibsqlContainer.pipe(
      Effect.andThen((container) =>
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([['TURSO_URL', `http://localhost:${container.getMappedPort(8080)}`]])
          )
        )
      )
    )
  );

  static Live = this.ClientLive.pipe(
    Layer.provideMerge(LibsqlSdk.Default),
    Layer.provide(this.ConfigLive),
    Layer.provide(this.ContainerLive)
  );
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
