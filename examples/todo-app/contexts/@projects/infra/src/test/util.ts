import { Effect, Config, Context, Layer, ManagedRuntime, Redacted } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Live as LibsqlInfraLive, LibsqlConfig, LibsqlSdk } from '@hex-effect/infra-libsql-nats';
import { Live as PgInfraLive, PgConfig } from '@hex-effect/infra-pg-nats';
import { NatsConfig } from '@hex-effect/infra-nats';
import { UUIDGenerator } from '@hex-effect/core';
import { SqlClient } from '@effect/sql';
import { EventHandlersLive } from '../event-handlers.js';
import { BadgesInfraLive } from '@badges/infra';
import { BadgesServiceLive, ServiceLive } from '../index.js';
import type { Services as BadgeServices } from '@badges/application';
import type { Services as ProjectServices } from '@projects/application';
import { WithTransaction, EventConsumer } from '@hex-effect/core';

type AppContext =
  | ProjectServices.SaveProject
  | ProjectServices.GetAllProjects
  | ProjectServices.FindProjectById
  | ProjectServices.SaveTask
  | ProjectServices.DeleteTask
  | ProjectServices.GetTasksByProjectId
  | ProjectServices.FindTaskById
  | ProjectServices.UpdateTask
  | BadgeServices.GetAllBadges
  | WithTransaction
  | UUIDGenerator
  | EventConsumer
  | SqlClient.SqlClient;

// ─── Containers ──────────────────────────────────────────────────────────────

class LibsqlContainer extends Context.Tag('test/LibsqlContainer')<
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
          .withWaitStrategy(Wait.forListeningPorts())
          .start()
      ),
      (c) => Effect.promise(() => c.stop())
    )
  );
}

class PgContainer extends Context.Tag('test/PgContainer')<PgContainer, StartedTestContainer>() {
  static Live = Layer.scoped(
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
      (c) => Effect.promise(() => c.stop())
    )
  );
}

class NatsContainer extends Context.Tag('test/NatsContainer')<
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
      (c) => Effect.promise(() => c.stop())
    )
  );
}

// ─── Shared NATS config ───────────────────────────────────────────────────────

const natsConfigLayer = Layer.unwrapEffect(
  NatsContainer.pipe(
    Effect.andThen((c) =>
      Layer.succeed(NatsConfig, {
        config: Config.map(
          Config.succeed(`nats://${c.getHost()}:${c.getMappedPort(4222)}`),
          (servers) => ({ servers })
        ),
        appNamespace: Config.succeed('test-app')
      })
    )
  )
).pipe(Layer.provide(NatsContainer.Live));

// ─── LibSQL full-stack layer ──────────────────────────────────────────────────

const libsqlConfigLayer = Layer.unwrapEffect(
  LibsqlContainer.pipe(
    Effect.andThen((c) =>
      Layer.succeed(LibsqlConfig, {
        config: { url: Config.succeed(`http://${c.getHost()}:${c.getMappedPort(8080)}`) }
      })
    )
  )
).pipe(Layer.provide(LibsqlContainer.Live));

const libsqlMigrationsLayer = Layer.unwrapEffect(
  LibsqlSdk.sdk.pipe(
    Effect.flatMap((sdk) =>
      Effect.promise(() =>
        sdk.migrate([
          {
            sql: `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL)`,
            args: []
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, completed INTEGER NOT NULL, description TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id))`,
            args: []
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS badges (id TEXT PRIMARY KEY NOT NULL, badge_type TEXT NOT NULL, awarded_at INTEGER NOT NULL)`,
            args: []
          }
        ])
      )
    ),
    Effect.as(Layer.empty)
  )
);

const libsqlBaseLayer = LibsqlInfraLive.pipe(
  Layer.provide(Layer.merge(libsqlConfigLayer, natsConfigLayer)),
  Layer.provideMerge(UUIDGenerator.Default)
);

export const libsqlAppLayer = Layer.mergeAll(
  libsqlMigrationsLayer,
  EventHandlersLive,
  BadgesInfraLive
).pipe(Layer.provideMerge(libsqlBaseLayer));

// ─── PostgreSQL full-stack layer ──────────────────────────────────────────────

const pgConfigLayer = Layer.unwrapEffect(
  PgContainer.pipe(
    Effect.andThen((c) =>
      Layer.succeed(PgConfig, {
        config: Config.map(
          Config.succeed(
            `postgresql://hexeffect:hexeffect@${c.getHost()}:${c.getMappedPort(5432)}/hexeffect`
          ),
          (url) => ({ url: Redacted.make(url) })
        )
      })
    )
  )
).pipe(Layer.provide(PgContainer.Live));

const pgMigrationsLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, completed INTEGER NOT NULL, description TEXT NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS badges (id TEXT PRIMARY KEY NOT NULL, badge_type TEXT NOT NULL, awarded_at BIGINT NOT NULL)`;
    return Layer.empty;
  })
);

const pgBaseLayer = PgInfraLive.pipe(
  Layer.provide(Layer.merge(pgConfigLayer, natsConfigLayer)),
  Layer.provideMerge(UUIDGenerator.Default)
);

export const pgAppLayer = Layer.mergeAll(
  pgMigrationsLayer,
  EventHandlersLive,
  BadgesInfraLive
).pipe(Layer.provideMerge(pgBaseLayer));
// ─── Public: parameterized runtime factory ────────────────────────────────────

const makeAppRuntime = (
  appLayer: typeof libsqlAppLayer | typeof pgAppLayer
): ManagedRuntime.ManagedRuntime<AppContext, never> =>
  ManagedRuntime.make(
    Layer.mergeAll(ServiceLive, BadgesServiceLive).pipe(Layer.provideMerge(appLayer))
  ) as ManagedRuntime.ManagedRuntime<AppContext, never>;

const libsqlCleanup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM hex_effect_events`;
  yield* sql`DELETE FROM badges`;
  yield* sql`DELETE FROM tasks`;
  yield* sql`DELETE FROM projects`;
}).pipe(Effect.orDie);

const pgCleanup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`TRUNCATE projects, tasks, badges, hex_effect_events`;
}).pipe(Effect.orDie);

export const backends = [
  {
    name: 'LibSQL',
    makeRuntime: () => makeAppRuntime(libsqlAppLayer),
    cleanup: libsqlCleanup
  },
  {
    name: 'PostgreSQL',
    makeRuntime: () => makeAppRuntime(pgAppLayer),
    cleanup: pgCleanup
  }
] as const;

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
