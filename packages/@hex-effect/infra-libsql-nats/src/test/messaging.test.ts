import { beforeEach, describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Layer, Stream, Fiber, Chunk, ConfigProvider, Deferred } from 'effect';
import { makeDomainEvent } from '@hex-effect/core';
import { Schema } from '@effect/schema';
import { NatsClient, NatsEventConsumer, PublishEvent } from '../messaging.js';
import { UnpublishedEventRecord } from '../event-store.js';
import { NatsContainer } from './util.js';

const SomeEvent = makeDomainEvent(
  { _tag: 'SomeEvent', _context: 'SomeContext' },
  { name: Schema.String }
);

const TestLive = PublishEvent.Default.pipe(
  Layer.provideMerge(NatsContainer.ClientLive),
  Layer.provide(
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['APPLICATION_NAMESPACE', 'kralf']])))
  )
);

describe('Messaging', () => {
  layer(TestLive)((it) => {
    let event: ReturnType<(typeof SomeEvent)['make']>;

    const publish = (e: typeof event) =>
      PublishEvent.publish(
        UnpublishedEventRecord.make({
          ...e,
          payload: JSON.stringify(e)
        })
      );

    beforeEach(() => {
      event = SomeEvent.make({ name: 'Jeff' });
    });

    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const sub = yield* Effect.acquireRelease(
          Config.string('APPLICATION_NAMESPACE').pipe(
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
        yield* publish(event);
        const received = yield* Deferred.await(deferred);
        expect(event).toMatchObject(received);
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );
  });
});
