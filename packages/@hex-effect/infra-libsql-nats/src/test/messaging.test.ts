import { describe, expect, layer } from '@effect/vitest';
import {
  Effect,
  Config,
  Layer,
  Stream,
  Fiber,
  Chunk,
  Deferred,
  Struct,
  Schema,
  Queue
} from 'effect';
import { EventBaseSchema, makeDomainEvent, UUIDGenerator } from '@hex-effect/core';
import {
  NatsClient,
  NatsConfig,
  NatsEventConsumer,
  PublishEvent,
  UnpublishedEventRecord
} from '@hex-effect/infra-nats';
import { NatsContainer } from './util.js';

const SomeEvent = makeDomainEvent(
  { _tag: 'SomeEvent', _context: 'SomeContext' },
  { name: Schema.String }
);

const AnotherEvent = makeDomainEvent(
  { _tag: 'AnotherEvent', _context: 'SomeContext' },
  { name: Schema.String }
);

const TestLive = PublishEvent.Default.pipe(
  Layer.provideMerge(UUIDGenerator.Default),
  Layer.provideMerge(NatsContainer.ConfigLive)
);

describe('Messaging', () => {
  layer(TestLive)((it) => {
    const publish = (e: typeof EventBaseSchema.Type) =>
      PublishEvent.publish(UnpublishedEventRecord.make({ ...e, payload: JSON.stringify(e) }));

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

    it.effect('EventConsumer processes multiple events', () =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<typeof AnotherEvent.schema.Type>();
        yield* NatsEventConsumer.use((c) =>
          c.register([AnotherEvent], (e) => Queue.offer(queue, e), { $durableName: 'shmee-multi' })
        );
        const event1 = yield* AnotherEvent.make({ name: 'first' });
        const event2 = yield* AnotherEvent.make({ name: 'second' });
        yield* publish(event1);
        yield* publish(event2);
        const received1 = yield* Queue.take(queue);
        const received2 = yield* Queue.take(queue);
        expect(event1).toMatchObject(received1);
        expect(event2).toMatchObject(received2);
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
