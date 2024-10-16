import { Effect, Config, Context, Layer, Struct } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { LibsqlClient } from '@effect/sql-libsql';
import { Schema } from '@effect/schema';
import { Model, SqlClient, SqlError, SqlResolver } from '@effect/sql';
import { makeDomainEvent } from '@hex-effect/core';
import { nanoid } from 'nanoid';
import type { ParseError } from '@effect/schema/ParseResult';
import { LibsqlConfig, LibsqlSdk, WriteStatement } from '../sql.js';
import { NatsClient, NatsConfig } from '../messaging.js';

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
            config: {
              servers: Config.succeed(`nats://localhost:${container.getMappedPort(4222)}`)
            },
            appNamespace: Config.succeed('KRALF')
          });
        })
      )
    ),
    Layer.provide(this.Live)
  );
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

export const PersonId = Schema.NonEmptyTrimmedString.pipe(Schema.brand('PersonId'));

export const PersonCreatedEvent = makeDomainEvent(
  { _tag: 'PersonCreatedEvent', _context: '@test' },
  { id: PersonId }
);

const PersonDomainModel = Schema.Struct({
  id: PersonId,
  name: Schema.Trim.pipe(Schema.compose(Schema.NonEmptyString))
});

class PersonSQLModel extends Model.Class<PersonSQLModel>('PersonSQLModel')({
  ...PersonDomainModel.fields,
  id: Model.GeneratedByApp(PersonId),
  createdAt: Model.DateTimeInsertFromNumber,
  updatedAt: Model.DateTimeUpdateFromNumber
}) {}

class SavePerson extends Context.Tag('test/SavePerson')<
  SavePerson,
  (person: typeof PersonDomainModel.Type) => Effect.Effect<void, ParseError | SqlError.SqlError>
>() {
  public static live = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const w = yield* WriteStatement;
      return (person) =>
        Effect.gen(function* () {
          const insert = yield* Schema.encode(PersonSQLModel.insert)(
            PersonSQLModel.insert.make(person)
          );
          yield* w(sql`insert into people ${sql.insert(insert)};`);
        });
    })
  );
}

export const addPerson = (name: string) =>
  Effect.gen(function* () {
    const person = yield* Schema.decode(PersonDomainModel)({
      name,
      id: PersonId.make(nanoid())
    });
    const save = yield* SavePerson;
    yield* save(person);
    return [yield* PersonCreatedEvent.make({ id: person.id })] as const;
  }).pipe(Effect.provide(SavePerson.live));

export const GetByIdResolver = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return yield* SqlResolver.findById('GetPersonById', {
    Id: PersonId,
    Result: PersonSQLModel.select,
    ResultId: (result) => result.id,
    execute: (ids) => sql`SELECT * FROM people WHERE id IN ${sql.in(ids)};`
  });
});

export const Migrations = Layer.scopedDiscard(
  Effect.gen(function* () {
    const sql = yield* LibsqlClient.LibsqlClient;
    const migrateDatabase = sql`create table people (id text primary key not null, name text not null, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`;
    yield* Effect.acquireRelease(migrateDatabase, () => resetDatabase);
  })
);
