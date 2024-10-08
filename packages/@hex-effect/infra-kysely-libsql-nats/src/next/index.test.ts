import { Model, SqlClient, SqlError } from '@effect/sql';
import { LibsqlClient } from './libsql-client/index.js';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Context, Layer, String, identity } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Schema } from '@effect/schema';
import { EventBaseSchema, IsolationLevel, withNextTXBoundary } from '@hex-effect/core';
import { nanoid } from 'nanoid';
import type { ParseError } from '@effect/schema/ParseResult';
import { EventStoreLive, GetUnpublishedEvents, WriteStatement, WTLive } from './index.js';
import { get } from 'effect/Struct';

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
        url: Config.succeed(`http://localhost:${container.getMappedPort(8080)}`),
        transformQueryNames: Config.succeed(String.camelToSnake),
        transformResultNames: Config.succeed(String.snakeToCamel)
      });
    })
  ).pipe(Layer.provide(this.Live));
}

const TestEventBase = Schema.Struct({
  ...EventBaseSchema.omit('_context', '_tag').fields,
  _context: Schema.Literal('@test').pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => '@test' as const)
  )
});

export class PersonCreatedEvent extends Schema.TaggedClass<PersonCreatedEvent>()(
  'PersonCreatedEvent',
  {
    ...TestEventBase.fields,
    id: Schema.String
  }
) {
  encode() {
    return Schema.encode(PersonCreatedEvent)(this);
  }
}

const PersonId = Schema.NonEmptyTrimmedString.pipe(Schema.brand('PersonId'));

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
  (person: typeof PersonDomainModel.Type) => Effect.Effect<void, SqlError.SqlError | ParseError>
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

const addPerson = (name: string) =>
  Effect.gen(function* () {
    const person = yield* Schema.decode(PersonDomainModel)({
      name,
      id: PersonId.make(nanoid())
    });
    const save = yield* SavePerson;
    yield* save(person);
    return [PersonCreatedEvent.make({ id: person.id })];
  }).pipe(Effect.provide(SavePerson.live));

const Migrations = Layer.scopedDiscard(
  Effect.gen(function* () {
    const sql = yield* LibsqlClient.LibsqlClient;

    const migrateDatabase = sql`create table people (id text primary key not null, name text not null, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`;

    const resetDatabase = Effect.gen(function* () {
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
        sql.sdk.migrate([
          `PRAGMA foreign_keys=OFF;`,
          ...dropTriggerCmds.map(get('cmd')),
          ...dropIndexCmds.map(get('cmd')),
          ...dropTableCmds.map(get('cmd')),
          `DELETE FROM hex_effect_events`,
          `PRAGMA foreign_keys=ON;`
        ])
      );
    }).pipe(Effect.orDie);

    yield* Effect.acquireRelease(migrateDatabase, () => resetDatabase);
  })
);

const TestLive = WTLive.pipe(
  Layer.provideMerge(EventStoreLive),
  Layer.provideMerge(WriteStatement.live),
  Layer.provideMerge(LibsqlContainer.ClientLive)
);

describe('WithTransaction', () => {
  layer(TestLive)((it) => {
    it.scoped('rolls back serializable', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson('Jeffrey ').pipe(
          Effect.andThen(Effect.fail('boom')),
          withNextTXBoundary(IsolationLevel.Serializable),
          Effect.ignore
        );
        const res = yield* sql<{
          count: number;
        }>`select count(*) as count from people;`;
        expect(res.at(0)!.count).toEqual(0);
      }).pipe(Effect.provide(Migrations))
    );

    it.scoped('rolls back batched', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson('Jeffrey ').pipe(
          Effect.andThen(Effect.fail('boom')),
          withNextTXBoundary(IsolationLevel.Batched),
          Effect.ignore
        );
        const res = yield* sql<{
          count: number;
        }>`select count(*) as count from people;`;
        expect(res.at(0)!.count).toEqual(0);
      }).pipe(Effect.provide(Migrations))
    );

    it.scoped('commits batched', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [event] = yield* addPerson('Kralf').pipe(withNextTXBoundary(IsolationLevel.Batched));
        const res = yield* sql<{
          name: string;
        }>`select * from people;`;
        expect(res.at(0)!.name).toEqual('Kralf');
        const events = yield* Effect.serviceFunctionEffect(GetUnpublishedEvents, identity)();
        expect(
          Schema.decodeUnknownSync(PersonCreatedEvent)(JSON.parse(events.at(0)!.payload))
        ).toEqual(event);
      }).pipe(Effect.provide(Migrations))
    );

    it.scoped('commits serializable', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [event] = yield* addPerson('Kralf').pipe(
          withNextTXBoundary(IsolationLevel.Serializable)
        );
        const res = yield* sql<{
          name: string;
        }>`select * from people;`;
        expect(res.at(0)!.name).toEqual('Kralf');
        const events = yield* Effect.serviceFunctionEffect(GetUnpublishedEvents, identity)();
        expect(
          Schema.decodeUnknownSync(PersonCreatedEvent)(JSON.parse(events.at(0)!.payload))
        ).toEqual(event);
      }).pipe(Effect.provide(Migrations))
    );
  });
});
