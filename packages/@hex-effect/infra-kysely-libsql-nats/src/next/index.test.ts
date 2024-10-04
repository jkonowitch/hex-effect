import { Model, SqlClient, SqlError } from '@effect/sql';
import { LibsqlClient } from './libsql-client/index.js';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Context, Layer } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Schema, Serializable } from '@effect/schema';
import { EventBaseSchema } from '@hex-effect/core';
import { nanoid } from 'nanoid';

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

class PersonModel extends Model.Class<PersonModel>('PersonModel')({
  id: Model.GeneratedByApp(PersonId),
  name: Schema.Trim
}) {}

class SavePerson extends Context.Tag('test/SavePerson')<
  SavePerson,
  (person: typeof PersonModel.insert.Type) => Effect.Effect<void, SqlError.SqlError>
>() {
  public static live = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      return (person) => sql`insert into people ${sql.insert(person)};`;
    })
  );
}

const addPerson = (p: typeof PersonModel.jsonCreate.Type) =>
  Effect.gen(function* () {
    const person = yield* Schema.decode(PersonModel.insert)({ ...p, id: PersonId.make(nanoid()) });
    const save = yield* SavePerson;
    yield* save(person);
    return [PersonCreatedEvent.make({ id: person.id })];
  });

const TestLive = SavePerson.live.pipe(
  Layer.provide(
    Layer.scopedDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Effect.acquireRelease(
          sql`create table people (id text primary key not null, name text not null);`,
          () => sql`drop table people;`.pipe(Effect.ignore)
        );
      })
    )
  ),
  Layer.provideMerge(LibsqlContainer.ClientLive)
);

describe('kralf', () => {
  layer(TestLive)((it) => {
    it.scoped('does a thing', () =>
      Effect.gen(function* () {
        const num = yield* Effect.succeed(4);
        expect(num).toEqual(4);
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson({ name: 'Jeffrey ' });
        const res = yield* sql`select * from people where name = ${'Jeffrey'};`;
        expect(res.at(0)?.name).toEqual('Jeffrey');
      })
    );
  });
});
