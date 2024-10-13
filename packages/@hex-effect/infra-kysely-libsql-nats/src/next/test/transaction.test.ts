import { SqlClient } from '@effect/sql';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Layer, identity, Stream, Fiber, pipe, Struct, Array } from 'effect';
import { Schema } from '@effect/schema';
import { IsolationLevel, withNextTXBoundary } from '@hex-effect/core';
import { GetUnpublishedEvents, MarkAsPublished, SaveEvents } from '../event-store.js';
import { LibsqlSdk } from '../sql.js';
import { UseCaseCommit, WithTransactionLive } from '../transactional-boundary.js';
import { addPerson, LibsqlContainer, Migrations, PersonCreatedEvent, PersonId } from './util.js';

const TestLive = Migrations.pipe(
  // provide/merge all these internal services so that I can test behavior
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
        ).toEqual(pipe(event!, Struct.omit('encode')));
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
        ).toEqual(pipe(event!, Struct.omit('encode')));
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(1);
      }).pipe(Effect.provide(TestLive))
    );

    const unpublishedMessageIds = GetUnpublishedEvents.pipe(
      Effect.flatMap((getUnpublished) => getUnpublished()),
      Effect.map(Array.map(Struct.get('messageId')))
    );

    it.effect('marks as published', () =>
      Effect.gen(function* () {
        const event = PersonCreatedEvent.make({ id: PersonId.make('123') });
        yield* SaveEvents.save([event]);
        expect(yield* unpublishedMessageIds).toContain(event.messageId);
        yield* MarkAsPublished.markAsPublished([event.messageId]);
        expect(yield* unpublishedMessageIds).not.toContain(event.messageId);
      }).pipe(Effect.provide(TestLive))
    );
  });
});
