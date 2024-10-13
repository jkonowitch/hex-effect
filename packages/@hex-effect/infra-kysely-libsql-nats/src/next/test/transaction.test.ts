import { Model, SqlClient, SqlError } from '@effect/sql';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Context, Layer, identity, Stream, Fiber, pipe } from 'effect';
import { Schema } from '@effect/schema';
import { makeDomainEvent, IsolationLevel, withNextTXBoundary } from '@hex-effect/core';
import { nanoid } from 'nanoid';
import type { ParseError } from '@effect/schema/ParseResult';
import { GetUnpublishedEvents, MarkAsPublished, SaveEvents } from '../event-store.js';
import { get, omit } from 'effect/Struct';
import { LibsqlClient } from '@effect/sql-libsql';
import { LibsqlSdk, WriteStatement } from '../sql.js';
import { UseCaseCommit, WithTransactionLive } from '../transactional-boundary.js';
import { LibsqlContainer } from './util.js';
import { map } from 'effect/Array';

const PersonCreatedEvent = makeDomainEvent(
  { _tag: 'PersonCreatedEvent', _context: '@test' },
  { id: Schema.String }
);

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
    const sdk = yield* LibsqlSdk.sdk;

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
        sdk.migrate([
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

const TestLive = Migrations.pipe(
  // provide/merge UseCaseCommit & GetUnpublishedEvents so that I can test behavior
  Layer.provideMerge(UseCaseCommit.live),
  Layer.provideMerge(GetUnpublishedEvents.live),
  Layer.provideMerge(SaveEvents.Default),
  Layer.provideMerge(MarkAsPublished.Default),
  Layer.provideMerge(WithTransactionLive),
  Layer.provideMerge(LibsqlSdk.Default)
);

describe('WithTransaction', () => {
  layer(LibsqlContainer.ConfigLive)((it) => {
    const countCommits = Effect.serviceConstants(UseCaseCommit).subscribe.pipe(
      Effect.andThen((queue) => Stream.fromQueue(queue).pipe(Stream.runCount, Effect.fork))
    );

    it.scoped('rolls back serializable', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
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
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(0);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('rolls back batched', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
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
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(0);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('commits batched', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
        const sql = yield* SqlClient.SqlClient;
        const [event] = yield* addPerson('Kralf').pipe(withNextTXBoundary(IsolationLevel.Batched));
        const res = yield* sql<{
          name: string;
        }>`select * from people;`;
        expect(res.at(0)!.name).toEqual('Kralf');
        const events = yield* Effect.serviceFunctionEffect(GetUnpublishedEvents, identity)();
        expect(
          Schema.decodeUnknownSync(PersonCreatedEvent.schema)(JSON.parse(events.at(0)!.payload))
        ).toEqual(pipe(event!, omit('encode')));
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(1);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('commits serializable', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
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
          Schema.decodeUnknownSync(PersonCreatedEvent.schema)(JSON.parse(events.at(0)!.payload))
        ).toEqual(pipe(event!, omit('encode')));
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(1);
      }).pipe(Effect.provide(TestLive))
    );

    it.effect('marks as published', () =>
      Effect.gen(function* () {
        const event = PersonCreatedEvent.make({ id: '123' });
        yield* SaveEvents.save([event]);
        const unpublishedMessageIds = GetUnpublishedEvents.pipe(
          Effect.flatMap((getUnpublished) => getUnpublished()),
          Effect.map(map(get('messageId')))
        );
        expect(yield* unpublishedMessageIds).toContain(event.messageId);
        yield* MarkAsPublished.markAsPublished([event.messageId]);
        expect(yield* unpublishedMessageIds).not.toContain(event.messageId);
      }).pipe(Effect.provide(TestLive))
    );
  });
});
