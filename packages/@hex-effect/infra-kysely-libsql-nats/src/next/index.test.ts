import { Model, SqlClient, SqlError } from '@effect/sql';
import { LibsqlClient } from './libsql-client/index.js';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Context, Layer, String, Console } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Schema, Serializable } from '@effect/schema';
import { EventBaseSchema, IsolationLevel, withNextTXBoundary } from '@hex-effect/core';
import { nanoid } from 'nanoid';
import type { ParseError } from '@effect/schema/ParseResult';
import { WriteStatement, WTLive } from './index.js';

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
  ...EventBaseSchema.fields,
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
  get [Serializable.symbol]() {
    return PersonCreatedEvent;
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
  });

const Migrations = Layer.scopedDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Effect.acquireRelease(
      sql`create table people (id text primary key not null, name text not null, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
      () => sql`drop table people;`.pipe(Effect.ignore)
    );
  })
);

const TestLive = WTLive.pipe(
  Layer.provideMerge(SavePerson.live),
  Layer.provideMerge(WriteStatement.live),
  Layer.provideMerge(LibsqlContainer.ClientLive)
);

describe('kralf', () => {
  layer(TestLive)((it) => {
    it.scoped('does a thing 1', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const events = yield* addPerson('Jeffrey ');
        const res = yield* sql<{
          name: string;
        }>`select * from people where id = ${events.at(0)!.id};`;
        yield* Console.log(res);
        expect(res.at(0)!.name).toEqual('Jeffrey');
      }).pipe(Effect.provide(Migrations))
    );

    it.scoped('does a thing 2', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson('Kralf').pipe(withNextTXBoundary(IsolationLevel.Batched));
        const res = yield* sql<{
          name: string;
        }>`select * from people;`;
        yield* Console.log(res);
        expect(res.at(0)!.name).toEqual('Kralf');
      }).pipe(Effect.provide(Migrations))
    );
  });
});
