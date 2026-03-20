import { beforeEach, describe, expect, it } from '@effect/vitest';
import { addPerson, NatsContainer, PgContainer, PersonCreatedEvent } from './util.js';
import { Deferred, Effect, Layer, ManagedRuntime, Option } from 'effect';
import { Live } from '../index.js';
import { EventConsumer, IsolationLevel, UUIDGenerator, withTXBoundary } from '@hex-effect/core';
import { SqlClient } from '@effect/sql';

const IntegrationLive = Live.pipe(
  Layer.provideMerge(UUIDGenerator.Default),
  Layer.provide(Layer.merge(PgContainer.ConfigLive, NatsContainer.ConfigLive))
);

const makeRuntime = () => ManagedRuntime.make(IntegrationLive);

describe('Integration Test (PG)', () => {
  let runtime: ReturnType<typeof makeRuntime>;

  beforeEach(() => {
    runtime = makeRuntime();
  });

  it.scoped('works', () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => runtime.disposeEffect);

      const MigrationsLive = Layer.unwrapEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)`;
          return Layer.empty;
        })
      );

      const deferred = yield* Deferred.make<typeof PersonCreatedEvent.schema.Type>();

      const { register } = yield* EventConsumer;
      yield* register([PersonCreatedEvent], (e) => Deferred.succeed(deferred, e), {
        $durableName: 'test-consumer'
      });

      const [event] = yield* addPerson('Jeff').pipe(
        withTXBoundary(IsolationLevel.Batched),
        Effect.provide(MigrationsLive)
      );

      // ensure entity was persisted
      const sql = yield* SqlClient.SqlClient;
      const res = yield* sql<{ name: string }>`SELECT * FROM people WHERE id = ${event!.id}`;
      expect(Option.getOrThrow(Option.fromNullable(res.at(0)))?.name).toEqual('Jeff');

      // ensure event is received
      const received = yield* Deferred.await(deferred);
      expect(event).toMatchObject(received);
    }).pipe(Effect.provide(runtime))
  );
});
