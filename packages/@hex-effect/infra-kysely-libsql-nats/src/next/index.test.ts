import { SqlClient } from '@effect/sql';
import { LibsqlClient } from './libsql-client/index.js';
import { describe, expect, layer } from '@effect/vitest';
import { Console, Effect, Config, Context, Layer } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export class LibsqlContainer extends Context.Tag('test/LibsqlContainer')<
  LibsqlContainer,
  StartedTestContainer
>() {
  static Live = Layer.scoped(
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

  static ClientLive = Layer.unwrapEffect(
    Effect.gen(function* () {
      const container = yield* LibsqlContainer;
      return LibsqlClient.layer({
        _tag: Config.succeed('Config'),
        url: Config.succeed(`http://localhost:${container.getMappedPort(8080)}`)
      });
    })
  ).pipe(Layer.provide(this.Live));
}

describe('kralf', () => {
  layer(LibsqlContainer.ClientLive)((it) => {
    it.scoped('does a thing', () =>
      Effect.gen(function* () {
        const num = yield* Effect.succeed(4);
        expect(num).toEqual(4);
        const sql = yield* SqlClient.SqlClient;
        const res = yield* sql`select * from sqlite_master;`;
        yield* Console.log(res);
      })
    );
  });
});
