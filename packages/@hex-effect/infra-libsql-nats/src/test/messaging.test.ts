import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Layer, Stream, Fiber, Chunk, Deferred, Struct } from 'effect';
import { makeDomainEvent, UUIDGenerator } from '@hex-effect/core';
import { Schema } from '@effect/schema';
import { NatsClient, NatsConfig, NatsEventConsumer, PublishEvent } from '../messaging.js';
import { UnpublishedEventRecord } from '../event-store.js';
import { NatsContainer } from './util.js';

const SomeEvent = makeDomainEvent(
  { _tag: 'SomeEvent', _context: 'SomeContext' },
  { name: Schema.String }
);

const TestLive = PublishEvent.Default.pipe(
  Layer.provideMerge(UUIDGenerator.Default),
  Layer.provideMerge(NatsContainer.ConfigLive)
);

describe('Messaging', () => {
  layer(TestLive)((it) => {
    const publish = (e: Effect.Effect.Success<ReturnType<(typeof SomeEvent)['make']>>) =>
      PublishEvent.publish(
        UnpublishedEventRecord.make({
          ...e,
          payload: JSON.stringify(e)
        })
      );

    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const event = yield* SomeEvent.make({ name: 'Jeff' });
        const conn = yield* NatsClient;
        const sub = yield* Effect.acquireRelease(
          NatsConfig.pipe(
            Effect.map(Struct.get('appNamespace')),
            Effect.flatMap(Config.unwrap),
            Effect.flatMap((ns) =>
              Effect.sync(() =>
                conn.subscribe(`${ns}.${event._context}.${event._tag}`, {
                  timeout: 2000,
                  max: 1
                })
              )
            )
          ),
          (s) => Effect.promise(() => (s.isClosed() ? Promise.resolve() : s.drain()))
        );
        yield* publish(event);
        const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
          Stream.runCollect,
          Effect.fork
        );
        const msg = yield* Fiber.join(stream).pipe(Effect.flatMap(Chunk.get(0)));
        expect(msg.string()).toEqual(JSON.stringify(event));
      })
    );

    it.effect('EventConsumer', () =>
      Effect.gen(function* () {
        const event = yield* SomeEvent.make({ name: 'Jeff' });
        const deferred = yield* Deferred.make<typeof SomeEvent.schema.Type>();
        yield* NatsEventConsumer.use((c) =>
          c.register([SomeEvent], (e) => Deferred.succeed(deferred, e), { $durableName: 'shmee' })
        );
        yield* publish(event);
        const received = yield* Deferred.await(deferred);
        expect(event).toMatchObject(received);
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );

    it.effect('Retries when there is a defect', () =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<typeof SomeEvent.schema.Type>();
        let i = 0;
        yield* NatsEventConsumer.use((c) =>
          c.register(
            [SomeEvent],
            (e) => {
              const result =
                i === 1 ? Deferred.succeed(deferred, e) : Effect.dieMessage('error dawg');
              i++;
              return result;
            },
            { $durableName: 'shmee' }
          )
        );
        const event = yield* SomeEvent.make({ name: 'Jeff' });
        yield* publish(event);
        const received = yield* Deferred.await(deferred);
        expect(event).toMatchObject(received);
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );
  });
});
