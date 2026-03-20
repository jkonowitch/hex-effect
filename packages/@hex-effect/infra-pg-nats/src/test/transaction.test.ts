import { SqlClient } from '@effect/sql';
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Layer, identity, Stream, Fiber, Struct, Array, Schema } from 'effect';
import { IsolationLevel, UUIDGenerator, withTXBoundary } from '@hex-effect/core';
import {
  GetUnpublishedEvents,
  MarkAsPublished,
  SaveEvents,
  UseCaseCommit
} from '@hex-effect/infra-nats';
import { WithTransactionLive } from '../transactional-boundary.js';
import { addPerson, Migrations, PgContainer, PersonCreatedEvent, PersonId } from './util.js';

const TestLive = Migrations.pipe(
  Layer.provideMerge(UseCaseCommit.live),
  Layer.provideMerge(GetUnpublishedEvents.live),
  Layer.provideMerge(SaveEvents.Default),
  Layer.provideMerge(MarkAsPublished.Default),
  Layer.provideMerge(WithTransactionLive),
  Layer.provideMerge(UUIDGenerator.Default)
);

describe('WithTransaction (PG)', () => {
  layer(PgContainer.ConfigLive)((it) => {
    const countCommits = Effect.serviceConstants(UseCaseCommit).subscribe.pipe(
      Effect.andThen((queue) => Stream.fromQueue(queue).pipe(Stream.runCount, Effect.fork))
    );

    it.scoped('rolls back serializable', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson('Jeffrey').pipe(
          Effect.andThen(Effect.fail('boom')),
          withTXBoundary(IsolationLevel.Serializable),
          Effect.ignore
        );
        const res = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM people`;
        expect(res.at(0)!.count).toEqual(0);
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(0);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('rolls back batched', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
        const sql = yield* SqlClient.SqlClient;
        yield* addPerson('Jeffrey').pipe(
          Effect.andThen(Effect.fail('boom')),
          withTXBoundary(IsolationLevel.Batched),
          Effect.ignore
        );
        const res = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM people`;
        expect(res.at(0)!.count).toEqual(0);
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(0);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('commits batched', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
        const sql = yield* SqlClient.SqlClient;
        const [event] = yield* addPerson('Kralf').pipe(withTXBoundary(IsolationLevel.Batched));
        const res = yield* sql<{
          name: string;
        }>`SELECT * FROM people`;
        expect(res.at(0)!.name).toEqual('Kralf');
        const events = yield* Effect.serviceFunctionEffect(GetUnpublishedEvents, identity)();
        expect(event).toMatchObject(
          Schema.decodeUnknownSync(PersonCreatedEvent.schema)(JSON.parse(events.at(0)!.payload))
        );
        yield* Effect.serviceConstants(UseCaseCommit).shutdown;
        expect(yield* Fiber.join(count)).toEqual(1);
      }).pipe(Effect.provide(TestLive))
    );

    it.scoped('commits serializable', () =>
      Effect.gen(function* () {
        const count = yield* countCommits;
        const sql = yield* SqlClient.SqlClient;
        const [event] = yield* addPerson('Kralf').pipe(withTXBoundary(IsolationLevel.Serializable));
        const res = yield* sql<{
          name: string;
        }>`SELECT * FROM people`;
        expect(res.at(0)!.name).toEqual('Kralf');
        const events = yield* Effect.serviceFunctionEffect(GetUnpublishedEvents, identity)();
        expect(event).toMatchObject(
          Schema.decodeUnknownSync(PersonCreatedEvent.schema)(JSON.parse(events.at(0)!.payload))
        );
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
        const event = yield* PersonCreatedEvent.make({ id: PersonId.make('123') });
        yield* SaveEvents.use((service) => service.save([event]));
        expect(yield* unpublishedMessageIds).toContain(event.messageId);
        yield* MarkAsPublished.markAsPublished([event.messageId]);
        expect(yield* unpublishedMessageIds).not.toContain(event.messageId);
      }).pipe(Effect.provide(TestLive))
    );
  });
});
